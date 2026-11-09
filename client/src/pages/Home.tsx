import { Fragment, useEffect, useRef, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { useTheme } from "@/contexts/ThemeContext";
import { trpc } from "@/lib/trpc";
import * as tf from "@tensorflow/tfjs";
import "@tensorflow/tfjs-backend-webgl";
import "@tensorflow/tfjs-backend-cpu";
import * as cocoSsd from "@tensorflow-models/coco-ssd";
import * as mobilenet from "@tensorflow-models/mobilenet";
import * as poseDetection from "@tensorflow-models/pose-detection";
import { isDrinkingAction, isReliableFloorSitting, prioritizeDetections } from "@/lib/violationDetection";
import {
  Activity,
  ArrowLeft,
  ArrowUpLeft,
  BellRing,
  Bot,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  Eye,
  FileCheck2,
  Github,
  Globe2,
  Layers3,
  LockKeyhole,
  Moon,
  Menu,
  Network,
  Play,
  Radar,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Sun,
  Sparkles,
  TrainFront,
  UserCheck,
  X,
  Zap,
  FileUp,
  LogIn,
  Loader2,
  Paperclip,
  Search,
  CheckCircle2,
  XCircle,
} from "lucide-react";

const capabilities = [
  {
    number: "01",
    icon: ScanLine,
    title: "Real-time detection",
    description: "Detect behaviors and violations across video streams as they happen, without disrupting station operations.",
    tone: "blue",
  },
  {
    number: "02",
    icon: Bot,
    title: "Context intelligence",
    description: "Computer vision models distinguish passing events from incidents that require alerting and review.",
    tone: "amber",
  },
  {
    number: "03",
    icon: FileCheck2,
    title: "Evidence-backed records",
    description: "Turn every incident into a concise record with time, location, and confidence evidence.",
    tone: "violet",
  },
];

const events = [
  { time: "22:41", title: "Crossed movement boundary", place: "Financial District Station · Gate B", level: "Alert", icon: CircleAlert, color: "amber" },
  { time: "22:37", title: "Restricted-area standing", place: "Olaya Station · Platform 2", level: "Under review", icon: Eye, color: "blue" },
  { time: "22:29", title: "Gate congestion", place: "KAFD Station · East entrance", level: "Resolved", icon: Check, color: "green" },
];

const workflowSteps = [
  { number: "01", title: "Open the camera", detail: "A metro or demo camera begins monitoring the scene continuously.", icon: Camera },
  { number: "02", title: "Analyze the frame", detail: "Every frame passes through Computer Vision to recognize people, objects, and behaviors.", icon: ScanLine },
  { number: "03", title: "Detect the violation", detail: "RSD identifies eating, drinking, restricted seating, and other rule violations.", icon: CircleAlert },
  { number: "04", title: "Log and alert", detail: "It records the type, time, and location, then alerts the supervisor instantly.", icon: BellRing },
];

function BrandMark({ small = false }: { small?: boolean }) {
  return <img className={`brand-logo ${small ? "brand-logo-small" : ""}`} src="/manus-storage/rased-logo-cropped_b01d99cc.png" alt="RSD" />;
}

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return <p className="section-eyebrow"><span />{children}</p>;
}
type JourneyStage = "idle" | "active" | "violation-pending" | "violation-confirmed" | "hold" | "completed";
type JourneyEvent = { camera: string; time: string; note: string };
type TrackedPerson = { id: string; score: number; x: number; y: number; width: number; height: number; lastSeen: number };
export default function Home() {
  // The useAuth hook provides authentication state.
  // To implement login/logout, call logout(), or start login from an event
  // handler: onClick={() => startLogin()} (imported from "@/const"). Never call
  // startLogin() during render (no href={startLogin()}) — it mints a one-time
  // nonce cookie and must run only at the moment of navigation.
  let { user, loading, error, isAuthenticated, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const [menuOpen, setMenuOpen] = useState(false);
  const [showDemo, setShowDemo] = useState(false);
  const [demoSent, setDemoSent] = useState(false);
  const [activeWorkflow, setActiveWorkflow] = useState(2);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [modelLoading, setModelLoading] = useState(false);
  const [testAlert, setTestAlert] = useState(false);
  const [detectedItems, setDetectedItems] = useState<{ label: string; score: number; x: number; y: number; width: number; height: number; trackingId?: string }[]>([]);
  const [trackedPeople, setTrackedPeople] = useState<TrackedPerson[]>([]);
  const [journeyStage, setJourneyStage] = useState<JourneyStage>("idle");
  const [journey, setJourney] = useState({ trackingId: "", tripId: "", cardId: "", currentCamera: "—", violationStatus: "None", cardStatus: "ACTIVE", exitTime: "—" });
  const [journeyEvents, setJourneyEvents] = useState<JourneyEvent[]>([]);
  const [exitCardId, setExitCardId] = useState("");
  const [journeyNotice, setJourneyNotice] = useState("");
  const [dashboardTab, setDashboardTab] = useState("overview");
  const [violationFilter, setViolationFilter] = useState("All");
  const [showTripHistory, setShowTripHistory] = useState(false);
  const [dismissedTripIds, setDismissedTripIds] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem("rsd-dismissed-trip-ids");
      return stored ? JSON.parse(stored) as string[] : [];
    } catch {
      return [];
    }
  });
  const [simulationCamera, setSimulationCamera] = useState("C01");
  const [selectedTripId, setSelectedTripId] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastAlertRef = useRef("");
  const lastPersistedDetectionRef = useRef("");
  const violationCandidateRef = useRef({ label: "", frames: 0 });
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const modelRef = useRef<any>(null);
  const tracksRef = useRef<TrackedPerson[]>([]);
  const nextPersonIdRef = useRef(34);
  const linkedPersonIdRef = useRef<string | null>(null);
  const evidenceInputRef = useRef<HTMLInputElement>(null);
  const [uploadMessage, setUploadMessage] = useState("");
  const evidenceQuery = trpc.evidence.list.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const dashboardSummaryQuery = trpc.dashboard.summary.useQuery(undefined, { enabled: isAuthenticated, retry: false, refetchInterval: 15000 });
  const incidentsQuery = trpc.dashboard.incidents.useQuery({ status: violationFilter === "All" ? undefined : violationFilter.toLowerCase() as "pending" | "confirmed" | "rejected" }, { enabled: isAuthenticated, retry: false });
  const tripsQuery = trpc.dashboard.trips.useQuery(undefined, { enabled: isAuthenticated, retry: false, refetchInterval: 3000, refetchIntervalInBackground: true, refetchOnWindowFocus: true, refetchOnReconnect: true, staleTime: 0 });
  const activeTrips = tripsQuery.data?.filter((trip) => trip.status === "active" || trip.status === "hold") ?? [];
  const visibleTrips = showTripHistory ? (tripsQuery.data ?? []) : activeTrips.filter((trip) => !dismissedTripIds.includes(trip.tripId));
  const selectedActiveTrip = activeTrips.find((trip) => trip.tripId === selectedTripId) ?? activeTrips[0];
  const recordDetection = trpc.dashboard.recordDetection.useMutation({ onSuccess: () => { void dashboardSummaryQuery.refetch(); void incidentsQuery.refetch(); } });
  const reviewIncident = trpc.dashboard.reviewIncident.useMutation({ onSuccess: () => { void dashboardSummaryQuery.refetch(); void incidentsQuery.refetch(); void tripsQuery.refetch(); }, onError: (error) => setJourneyNotice(error.message || "Link the violation to an active Trip ID before confirming it.") });
  const dismissTrip = (tripId: string) => {
    setDismissedTripIds((current) => {
      const next = current.includes(tripId) ? current : [...current, tripId];
      localStorage.setItem("rsd-dismissed-trip-ids", JSON.stringify(next));
      return next;
    });
  };

  useEffect(() => {
    const nextTripId = selectedActiveTrip?.tripId ?? "";
    const nextCardId = selectedActiveTrip?.cardUid ?? "";
    linkedPersonIdRef.current = null;
    setJourney((current) => current.tripId === nextTripId
      ? current
      : { ...current, tripId: nextTripId, cardId: nextCardId || (nextTripId ? current.cardId : "") });
  }, [selectedActiveTrip?.tripId, selectedActiveTrip?.cardUid]);
  const uploadEvidence = trpc.evidence.upload.useMutation({
    onSuccess: async () => {
      setUploadMessage("Evidence uploaded securely.");
      await evidenceQuery.refetch();
    },
    onError: (uploadError) => setUploadMessage(uploadError.message || "Upload failed. Please try again."),
  });

  const handleEvidenceUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      setUploadMessage("Files must be 15 MB or smaller.");
      return;
    }
    setUploadMessage("Preparing secure upload...");
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) {
      const chunk = bytes.subarray(index, index + 0x8000);
      for (let offset = 0; offset < chunk.length; offset += 1) binary += String.fromCharCode(chunk[offset]);
    }
    uploadEvidence.mutate({
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      fileSize: file.size,
      dataBase64: btoa(binary),
      trackingId: journey.trackingId || undefined,
      tripId: journey.tripId || undefined,
    });
  };

  useEffect(() => {
    return () => {
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    const refreshTrips = () => { if (document.visibilityState === "visible") void tripsQuery.refetch(); };
    window.addEventListener("focus", refreshTrips);
    document.addEventListener("visibilitychange", refreshTrips);
    window.addEventListener("online", refreshTrips);
    return () => {
      window.removeEventListener("focus", refreshTrips);
      document.removeEventListener("visibilitychange", refreshTrips);
      window.removeEventListener("online", refreshTrips);
    };
  }, [isAuthenticated, tripsQuery.refetch]);

  useEffect(() => {
    if (!cameraActive || !videoRef.current) return;
    let animationFrame = 0;
    let lastScan = 0;
    const scan = async (timestamp: number) => {
      const video = videoRef.current;
      if (!video || video.readyState < 2) {
        animationFrame = requestAnimationFrame(scan);
        return;
      }
      if (timestamp - lastScan > 700) {
        lastScan = timestamp;
        try {
          setModelLoading(true);
          await tf.ready();
          if (tf.getBackend() !== "webgl") {
            try { await tf.setBackend("webgl"); await tf.ready(); } catch { await tf.setBackend("cpu"); await tf.ready(); }
          }
          if (!modelRef.current?.detector) modelRef.current = { detector: await cocoSsd.load(), classifier: null, pose: null };
          if (!modelRef.current.pose) modelRef.current.pose = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING });
          if (!modelRef.current.classifier) {
            try { modelRef.current.classifier = await mobilenet.load(); } catch { modelRef.current.classifier = "unavailable"; }
          }
          setModelLoading(false);
          const predictions = await modelRef.current.detector.detect(video);
          const personPredictions = predictions.filter((item: any) => item.class === "person" && item.score > 0.42);
          const nextTracks: TrackedPerson[] = [];
          const usedTrackIds = new Set<string>();
          personPredictions.forEach((item: any) => {
            const [x, y, width, height] = item.bbox;
            const centerX = x + width / 2;
            const centerY = y + height / 2;
            const previous = tracksRef.current.find((track) => !usedTrackIds.has(track.id) && Math.hypot((track.x * video.videoWidth / 100 + track.width * video.videoWidth / 200) - centerX, (track.y * video.videoHeight / 100 + track.height * video.videoHeight / 200) - centerY) < Math.max(video.videoWidth, video.videoHeight) * 0.18);
            const id = previous?.id ?? `P${String(nextPersonIdRef.current++).padStart(3, "0")}`;
            usedTrackIds.add(id);
            nextTracks.push({ id, score: Math.round(item.score * 100), x: x / video.videoWidth * 100, y: y / video.videoHeight * 100, width: width / video.videoWidth * 100, height: height / video.videoHeight * 100, lastSeen: timestamp });
          });
          tracksRef.current = nextTracks;
          setTrackedPeople(nextTracks);
          if (journey.tripId && !linkedPersonIdRef.current) linkedPersonIdRef.current = nextTracks[0]?.id ?? null;
          const classifications = modelRef.current.classifier !== "unavailable" ? await modelRef.current.classifier.classify(video, 3) : [];
          const foodWords = ["food", "dish", "meal", "pizza", "burger", "cheeseburger", "hot dog", "sandwich", "burrito", "taco", "cake", "doughnut", "pretzel", "bagel", "fruit", "apple", "banana", "orange", "lemon", "strawberry", "broccoli", "mushroom", "plate", "bowl", "cup", "coffee", "espresso", "water bottle"];
          const relevant = predictions
            .filter((item: any) => ["bottle", "cup", "banana", "apple", "sandwich", "orange", "bowl", "cake", "donut", "hot dog", "pizza"].includes(item.class) && item.score > 0.24)
            .map((item: any) => ({ label: item.class, score: Math.round(item.score * 100), x: item.bbox[0] / video.videoWidth * 100, y: item.bbox[1] / video.videoHeight * 100, width: item.bbox[2] / video.videoWidth * 100, height: item.bbox[3] / video.videoHeight * 100 }));
          const drinkObjects = predictions.filter((item: any) => ["bottle", "cup"].includes(item.class) && item.score > 0.32);
          const poses = await modelRef.current.pose.estimatePoses(video);
          const pose = poses[0];
          const keypoint = (name: string) => pose?.keypoints?.find((point: any) => point.name === name && point.score > 0.55);
          const person = predictions.find((item: any) => item.class === "person" && item.score > 0.45);
          if (person) {
            const [px, py, pw, ph] = person.bbox;
            const hips = [keypoint("left_hip"), keypoint("right_hip")].filter(Boolean);
            const knees = [keypoint("left_knee"), keypoint("right_knee")].filter(Boolean);
            const ankles = [keypoint("left_ankle"), keypoint("right_ankle")].filter(Boolean);
            const shoulders = [keypoint("left_shoulder"), keypoint("right_shoulder")].filter(Boolean);
            const averageY = (points: any[]) => points.length ? points.reduce((sum, point) => sum + point.y, 0) / points.length : 0;
            const hipY = averageY(hips);
            const kneeY = averageY(knees);
            const ankleY = averageY(ankles);
            const shoulderY = averageY(shoulders);
            const poseConfidence = [...hips, ...knees, ...ankles, ...shoulders].reduce((sum, point: any) => sum + (point?.score ?? 0), 0) / Math.max(hips.length + knees.length + ankles.length + shoulders.length, 1);
            const bodyHeight = Math.max(ph, 1);
            const nosePoint = keypoint("nose");
            const wrists = [keypoint("left_wrist"), keypoint("right_wrist")].filter(Boolean).map((point: any) => ({ x: point.x, y: point.y }));
            const drinkingObject = drinkObjects.find((item: any) => isDrinkingAction({
              objectCenterX: item.bbox[0] + item.bbox[2] / 2,
              objectCenterY: item.bbox[1] + item.bbox[3] / 2,
              objectWidth: item.bbox[2],
              objectHeight: item.bbox[3],
              personX: px,
              personY: py,
              personWidth: pw,
              personHeight: ph,
              nose: nosePoint ? { x: nosePoint.x, y: nosePoint.y } : undefined,
              wrists,
            }));
            if (drinkingObject) {
              relevant.splice(0, relevant.length, ...relevant.filter((item: any) => !["bottle", "cup"].includes(item.label)));
              relevant.push({ label: "drinking", score: Math.round(drinkingObject.score * 100), x: drinkingObject.bbox[0] / video.videoWidth * 100, y: drinkingObject.bbox[1] / video.videoHeight * 100, width: drinkingObject.bbox[2] / video.videoWidth * 100, height: drinkingObject.bbox[3] / video.videoHeight * 100 });
            } else {
              relevant.splice(0, relevant.length, ...relevant.filter((item: any) => !["bottle", "cup"].includes(item.label)));
            }
            const seatedGeometry = hips.length === 2 && knees.length === 2 && ankles.length === 2 && shoulders.length === 2
              && isReliableFloorSitting({
                personScore: person.score,
                personHeight: bodyHeight,
                videoHeight: video.videoHeight,
                poseConfidence,
                shoulderY,
                hipY,
                kneeY,
                ankleY,
                hasDrinkObject: Boolean(drinkingObject),
              });
            if (seatedGeometry && !relevant.some((item: any) => ["drinking"].includes(item.label))) {
              relevant.push({ label: "sitting on the floor", score: Math.round(Math.min(person.score, poseConfidence) * 100), x: px / video.videoWidth * 100, y: py / video.videoHeight * 100, width: pw / video.videoWidth * 100, height: ph / video.videoHeight * 100 });
            }
          }
          const foodClassification = classifications.find((item: any) => foodWords.some((word) => item.className.toLowerCase().includes(word)) && item.probability > 0.24);
          if (foodClassification && !["cup", "bottle", "water bottle"].some((word) => foodClassification.className.toLowerCase().includes(word)) && !relevant.some((item: any) => item.label === "sitting on the floor")) relevant.push({ label: foodClassification.className, score: Math.round(foodClassification.probability * 100), x: 35, y: 25, width: 30, height: 35 });
          const prioritized = prioritizeDetections(relevant) as typeof relevant;
          const ownedDetections = prioritized.map((item: any) => {
            const centerX = item.x + item.width / 2;
            const centerY = item.y + item.height / 2;
            const owner = nextTracks.find((track) => centerX >= track.x && centerX <= track.x + track.width && centerY >= track.y && centerY <= track.y + track.height)
              ?? nextTracks[0];
            return { ...item, trackingId: owner?.id };
          });
          const rawViolation = ownedDetections[0];
          if (rawViolation?.label === violationCandidateRef.current.label) violationCandidateRef.current.frames += 1;
          else violationCandidateRef.current = { label: rawViolation?.label ?? "", frames: rawViolation ? 1 : 0 };
          const requiresStability = ["sitting on the floor", "drinking"].includes(rawViolation?.label ?? "");
          const violation = rawViolation && (!requiresStability || violationCandidateRef.current.frames >= 3) ? rawViolation : undefined;
          setDetectedItems(violation ? [violation, ...ownedDetections.filter((item: any) => item !== violation)] : []);
          const violationKey = violation ? `${violation.trackingId ?? "unlinked"}:${violation.label}` : "";
          if (violation && lastAlertRef.current !== violationKey) {
            lastAlertRef.current = violationKey;
            if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification("RSD · Violation detected", { body: `${violation.label} detected. Please review the camera evidence.` });
            if (isAuthenticated && lastPersistedDetectionRef.current !== violationKey) {
              const linkedTripId = selectedActiveTrip?.tripId ?? journey.tripId;
              if (linkedTripId) {
                lastPersistedDetectionRef.current = violationKey;
                const isLinkedPerson = violation.trackingId !== undefined && violation.trackingId === linkedPersonIdRef.current;
                recordDetection.mutate({ detectionType: violationName(violation.label), cameraId: simulationCamera, trackingId: undefined, tripId: isLinkedPerson ? linkedTripId : undefined, confidence: violation.score, source: "camera", occurredAt: Date.now() });
              } else {
                setJourneyNotice("Scan an RFID card and refresh the active trip before recording a violation.");
              }
            }
          }
          if (!violation) { lastAlertRef.current = ""; lastPersistedDetectionRef.current = ""; }
        } catch {
          setModelLoading(false);
          setCameraError("Unable to analyze the frame. Check lighting, allow camera access, and try again");
        }
      }
      animationFrame = requestAnimationFrame(scan);
    };
    animationFrame = requestAnimationFrame(scan);
    return () => cancelAnimationFrame(animationFrame);
  }, [cameraActive, isAuthenticated, simulationCamera, journey.trackingId, journey.tripId]);

  const toggleCamera = async () => {
    if (cameraActive) {
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
      setCameraActive(false);
      setDetectedItems([]);
      tracksRef.current = [];
      setTrackedPeople([]);
      lastAlertRef.current = "";
      setTestAlert(false);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("This browser does not support camera access");
      return;
    }
    try {
      setCameraError("");
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      cameraStreamRef.current = stream;
      setCameraActive(true);
      if (journeyStage === "idle") scanEntry();
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.muted = true;
        await videoRef.current.play().catch(() => undefined);
      }
      if (typeof Notification !== "undefined" && Notification.permission === "default") Notification.requestPermission().catch(() => undefined);
    } catch (error) {
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
      setCameraActive(false);
      const name = error instanceof DOMException ? error.name : "";
      setCameraError(name === "NotAllowedError" ? "Camera permission is blocked. Allow camera access for this site, then try again." : "Unable to open camera. Check that no other app is using it, then try again.");
    }
  };

  const showTestAlert = () => {
    setCameraError("");
    setTestAlert(true);
    setDetectedItems([{ label: "sandwich", score: 99, x: 58, y: 28, width: 16, height: 22 }]);
    lastAlertRef.current = "sandwich";
    window.setTimeout(() => {
      setTestAlert(false);
      setDetectedItems([]);
    }, 5000);
  };
  const violationName = (label?: string) => label === "sitting on the floor" ? "Sitting on the floor" : label === "drinking" || label === "bottle" || label === "cup" ? "Drinking" : "Eating / drinking";
  const personDisplayId = (trackingId: string) => trackingId === linkedPersonIdRef.current && journey.tripId ? journey.tripId : "UNLINKED";
  const detectionDisplayId = (trackingId?: string) => trackingId === linkedPersonIdRef.current && journey.tripId ? journey.tripId : "UNLINKED";
  const journeyTime = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const addJourneyEvent = (camera: string, note: string) => { setJourneyEvents((events) => [...events, { camera, time: journeyTime(), note }]); setJourney((current) => ({ ...current, currentCamera: camera })); };
  const scanEntry = () => { const tripId = selectedActiveTrip?.tripId ?? ""; const cardId = selectedActiveTrip?.cardUid ?? ""; setJourneyStage("active"); setJourneyNotice(tripId ? "" : "No real RFID trip is available yet. Tap the Arduino card, then wait for the dashboard refresh."); setExitCardId(""); setSimulationCamera("C01"); setJourney({ trackingId: "", tripId, cardId, currentCamera: "Camera 01", violationStatus: "None", cardStatus: "ACTIVE", exitTime: "—" }); setJourneyEvents([{ camera: "ENTRY", time: journeyTime(), note: tripId ? `Real RFID trip linked: ${tripId}` : "Waiting for a real RFID trip from Arduino" }, { camera: "Camera 01", time: journeyTime(), note: tripId ? "Camera tracking linked to the RFID trip" : "No camera identity assigned without RFID" }]); };
  const switchSimulationCamera = () => { const cameras = ["C01", "C02", "C04", "C05"]; const next = cameras[(cameras.indexOf(simulationCamera) + 1) % cameras.length]; setSimulationCamera(next); if (journeyStage !== "idle" && journeyStage !== "completed" && journeyStage !== "hold") { const label = `Camera ${next.slice(1)}`; addJourneyEvent(label, journey.tripId ? `Trip ${journey.tripId} matched across cameras` : "Waiting for a real RFID trip"); if (next === "C04") { setJourneyStage("violation-pending"); setJourney((current) => ({ ...current, violationStatus: "Pending · Eating" })); } } };
  const advanceJourney = () => { if (journeyStage === "active" && !journeyEvents.some((event) => event.camera === "Camera 02")) addJourneyEvent("Camera 02", journey.tripId ? `Trip ${journey.tripId} continued to the next camera` : "No RFID trip linked yet"); else if (journeyStage === "violation-pending") addJourneyEvent("Camera 04", "Violation evidence captured"); else if (journeyStage === "violation-confirmed") addJourneyEvent("Camera 05", "Passenger approaching exit"); };
  const flagJourneyViolation = () => { setJourneyStage("violation-pending"); setJourney((current) => ({ ...current, violationStatus: "Pending · Eating" })); addJourneyEvent("Camera 04", "Eating detected · confidence 94%"); };
  const reviewViolation = (status: "Confirmed" | "Rejected") => { setJourneyStage(status === "Confirmed" ? "violation-confirmed" : "active"); setJourney((current) => ({ ...current, violationStatus: status === "Confirmed" ? "Confirmed · Eating" : "Rejected" })); };
  const scanExit = () => { if (!journey.cardId || exitCardId.trim().toUpperCase() !== journey.cardId.toUpperCase()) { setJourneyNotice("The exit card must match the real RFID card linked to this trip."); return; } const hasConfirmedViolation = journey.violationStatus.startsWith("Confirmed"); setJourneyNotice(""); setJourneyStage(hasConfirmedViolation ? "hold" : "completed"); setJourney((current) => ({ ...current, currentCamera: "EXIT", exitTime: journeyTime(), cardStatus: hasConfirmedViolation ? "HOLD" : "COMPLETED" })); setJourneyEvents((events) => [...events, { camera: "EXIT", time: journeyTime(), note: hasConfirmedViolation ? "Violation found · Card placed on HOLD" : "Exit allowed · Trip completed" }]); };
  const markPaid = () => { setJourneyStage("completed"); setJourney((current) => ({ ...current, cardStatus: "ACTIVE", violationStatus: "PAID" })); setJourneyEvents((events) => [...events, { camera: "Ticket counter", time: journeyTime(), note: "Payment recorded · HOLD released · Trip completed" }]); };
  const resetJourney = () => { setJourneyStage("idle"); setJourneyNotice(""); setExitCardId(""); setJourney({ trackingId: "", tripId: "", cardId: "", currentCamera: "—", violationStatus: "None", cardStatus: "ACTIVE", exitTime: "—" }); setJourneyEvents([]); };

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setMenuOpen(false);
  };

  const openDemo = () => { setDemoSent(false); setShowDemo(true); };

  return (
    <main dir="ltr" className="rsd-app min-h-screen overflow-hidden selection:bg-[#43d5ff] selection:text-[#071523]">
      <header className="camera-first-header" id="top">
        <button className="brand" onClick={() => scrollTo("top")} aria-label="Back to top"><BrandMark /></button>
        <div className="camera-first-nav">
          <button onClick={() => scrollTo("monitoring")}>Camera monitor</button>
          <button onClick={() => scrollTo("operations")}>Operations</button>
          <button onClick={() => scrollTo("privacy")}>Privacy</button>
        </div>
        <button className="theme-toggle" type="button" onClick={toggleTheme} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} title={theme === "dark" ? "Light mode" : "Dark mode"}>
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          <span>{theme === "dark" ? "Light" : "Dark"}</span>
        </button>
        <button className="nav-cta" onClick={openDemo}>Request a demo <ArrowLeft size={16} strokeWidth={2.3} /></button>
      </header>

      <section className="privacy-section" id="privacy">
        <div className="section-shell privacy-grid">
          <div className="privacy-card">
            <div className="privacy-orbit orbit-one" /><div className="privacy-orbit orbit-two" /><div className="shield-core"><ShieldCheck size={48} /></div>
            <div className="privacy-chip chip-one"><LockKeyhole size={15} />End-to-end encryption</div>
            <div className="privacy-chip chip-two"><Eye size={15} />Granular permissions</div>
            <div className="privacy-chip chip-three"><Clock3 size={15} />Controlled retention</div>
          </div>
          <div className="privacy-copy">
            <SectionEyebrow>Privacy at the core</SectionEyebrow>
            <h2>Intelligence does not come<br />at the cost of <span>trust.</span></h2>
            <p>RSD is privacy-led from day one, from access management to data protection and auditable operations.</p>
            <div className="privacy-checks"><span><Check size={15} />Encryption in transit and at rest</span><span><Check size={15} />Role-based permissions</span><span><Check size={15} />A clear audit trail for every action</span></div>
          </div>
        </div>
      </section>

      <section className="monitoring-section" id="monitoring">
        <div className="section-shell monitoring-header">
          <div><SectionEyebrow>How RSD works inside the metro?</SectionEyebrow><h2>From camera to<br /><span>live alert.</span></h2></div>
          <p>A continuous intelligence loop starts with every frame and ends with a clear action for the supervisor.</p>
        </div>
        <div className="section-shell monitoring-grid">
          <div className="workflow-steps">
            {workflowSteps.map((step, index) => { const Icon = step.icon; return <button className={`workflow-step ${activeWorkflow === index ? "active" : ""}`} key={step.number} onClick={() => setActiveWorkflow(index)}><span className="workflow-index">{step.number}</span><span className="workflow-step-icon"><Icon size={17} /></span><span className="workflow-step-copy"><b>{step.title}</b><small>{step.detail}</small></span><ChevronLeft size={17} /></button>; })}
          </div>
          <div className={`camera-demo ${cameraActive ? "device-camera" : ""}`} aria-label="Device camera monitoring">
            <div className="camera-topbar"><span><span className={`pulse-dot ${cameraActive ? "camera-on" : ""}`} /> {cameraActive ? "Live camera" : "Camera input"}</span><span className="frame-counter" aria-hidden="true" /></div>
            <div className="camera-scene" onClick={!cameraActive ? toggleCamera : undefined} onKeyDown={(event) => { if (!cameraActive && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); toggleCamera(); } }} role={!cameraActive ? "button" : undefined} tabIndex={!cameraActive ? 0 : -1} aria-label={!cameraActive ? "Tap to start monitoring" : "Live camera preview"}>
              <video ref={videoRef} className={`device-video ${cameraActive ? "visible" : ""}`} muted playsInline />
              {!cameraActive && <img className="camera-start-image" src="/manus-storage/rsd-camera-start_f3054d44.png" alt="Riyadh Metro monitoring camera start screen" />}
              {trackedPeople.map((person) => <div className="person-track-box" key={person.id} style={{ left: `${person.x}%`, top: `${person.y}%`, width: `${person.width}%`, height: `${person.height}%` }}><span>{personDisplayId(person.id)} · {person.score}%</span></div>)}
              {detectedItems.map((item, index) => <div className="live-detection" key={`${item.trackingId ?? "unlinked"}-${item.label}-${index}`} style={{ left: `${item.x}%`, top: `${item.y}%`, width: `${item.width}%`, height: `${item.height}%` }}><span>{detectionDisplayId(item.trackingId)} · {violationName(item.label)} · {item.score}%</span></div>)}
              <div className="scan-line" /><div className="camera-corner" /><div className="camera-corner corner-two" /><div className="scene-label"><Camera size={14} /> Camera {simulationCamera.slice(1)} <span>● {cameraActive ? "LIVE" : "DEMO"}</span></div>
            </div>
            <div className="camera-controls"><button className={`camera-toggle ${cameraActive ? "stop" : ""}`} onClick={toggleCamera}>{cameraActive ? "Stop camera" : "Open camera"}<Camera size={15} /></button><button className="camera-test" onClick={showTestAlert}>Test alert</button>{modelLoading && <span className="camera-loading">Loading vision model...</span>}{cameraError && <span className="camera-error">{cameraError}</span>}</div>
            <div className={`violation-alert ${detectedItems.length > 0 ? "show" : ""}`}><div className="alert-icon"><CircleAlert size={20} /></div><div><b>{testAlert ? "Test: violation detected" : "Employee alert · Violation detected"}</b><span>{testAlert ? "This is a test alert to verify the interface" : `${violationName(detectedItems[0]?.label)} detected in the current scene. Review required.`}</span></div><strong>Now</strong></div>
            <div className="camera-bottom"><span><Activity size={14} /> {cameraActive ? "Continuous analysis · Computer Vision" : "Analysis paused"}</span><span>Tracked people <b>{trackedPeople.length}</b> · Detected items <b>{detectedItems.length}</b></span></div>
          </div>
        </div>
      </section>

      <section className="operations-section" id="operations">
        <div className="section-shell operations-shell">
          <div className="operations-heading"><div><SectionEyebrow>RSD · Operations control</SectionEyebrow><h2>Review what the system <span>actually saw.</span></h2></div><p>Persistent dashboard data is separated from demo simulation. AI suggestions remain pending until an authorized operator reviews them.</p></div>
          {!isAuthenticated ? <div className="operations-login"><LogIn size={19} /><span>Sign in to view persisted detections and review incidents.</span><button className="evidence-action" type="button" onClick={() => startLogin()}>Sign in <ArrowLeft size={15} /></button></div> : <>
            <div className="operations-metrics">
              <div><small>Total detections</small><b>{dashboardSummaryQuery.data?.detections ?? "—"}</b><span>Stored events</span></div>
              <div className="metric-pending"><small>Pending review</small><b>{dashboardSummaryQuery.data?.pending ?? "—"}</b><span>Needs an operator</span></div>
              <div className="metric-confirmed"><small>Confirmed</small><b>{dashboardSummaryQuery.data?.confirmed ?? "—"}</b><span>Approved incidents</span></div>
              <div className="metric-rejected"><small>Rejected</small><b>{dashboardSummaryQuery.data?.rejected ?? "—"}</b><span>Dismissed events</span></div>
            </div>
            <div className="operations-panel rfid-panel">
              <div className="operations-panel-head"><div><b>RFID trip intake</b><small>Arduino Uno + RC522 via USB Serial · live refresh every 3 seconds{tripsQuery.dataUpdatedAt ? ` · updated ${new Date(tripsQuery.dataUpdatedAt).toLocaleTimeString()}` : ""}</small></div><div className="rfid-panel-actions"><button className="trip-history-toggle" type="button" onClick={() => setShowTripHistory((current) => !current)}>{showTripHistory ? "Active only" : `Show history (${tripsQuery.data?.length ?? 0})`}</button><button className="trip-refresh-button" type="button" onClick={() => void tripsQuery.refetch()} disabled={tripsQuery.isFetching}><RefreshCw size={13} className={tripsQuery.isFetching ? "spin" : ""} /> {tripsQuery.isFetching ? "Refreshing" : "Refresh now"}</button><span className="integration-badge">USB BRIDGE</span></div></div>
              {tripsQuery.isLoading ? <div className="operations-empty"><Loader2 className="spin" size={18} /> Loading trips...</div> : tripsQuery.error ? <div className="operations-empty error-state">RFID trips are unavailable. Configure the bridge key and database connection.</div> : visibleTrips.length ? <div className="trip-list">{visibleTrips.map((trip) => <div className="trip-row" key={trip.id}><div><b>{trip.tripId}</b><small className="trip-uid">RFID UID: {trip.cardUid || "Not available for this older trip"}</small><small>Started {new Date(trip.startedAt).toLocaleString()}</small></div><span className={`trip-status ${trip.status}`}>{trip.status}</span><span className="trip-source">RFID / USB</span>{!showTripHistory && <button className="trip-dismiss-button" type="button" onClick={() => dismissTrip(trip.tripId)} title="Hide this trip from the live log" aria-label={`Mark ${trip.tripId} as handled`}><Check size={13} /> Done</button>}</div>)}</div> : <div className="operations-empty"><span className="trip-empty-dot" /> {showTripHistory ? "No RFID trips received yet. Scan a card to create the first trip." : "No active trips. Completed trips are hidden from the live log."}</div>}
            </div>
            <div className="operations-panel">
              <div className="operations-panel-head"><div><b>Incident review queue</b><small>Live data from the RSD database · refreshes every 15 seconds</small></div><div className="operations-filters"><Search size={14} /><select value={violationFilter} onChange={(event) => setViolationFilter(event.target.value)} aria-label="Filter incidents"><option>All</option><option>Pending</option><option>Confirmed</option><option>Rejected</option></select></div></div>
              {incidentsQuery.isLoading ? <div className="operations-empty"><Loader2 className="spin" size={18} /> Loading incidents...</div> : incidentsQuery.error ? <div className="operations-empty error-state">Unable to load incidents. Check operator access and database configuration.</div> : incidentsQuery.data?.length ? <div className="incident-list">{incidentsQuery.data.map((row) => <div className="incident-row" key={row.incident.id}><div className="incident-main"><b>{row.detection.detectionType}</b><small>{row.detection.tripId ? `Trip ${row.detection.tripId}` : "No RFID trip linked"} · {row.detection.cameraId}</small></div><span className={`incident-status ${row.incident.status}`}>{row.incident.status}</span><span className="incident-confidence">{row.detection.confidence}%</span>{row.incident.status === "pending" && user?.role === "admin" ? <div className="incident-actions"><button aria-label="Confirm incident" title="Confirm incident" onClick={() => reviewIncident.mutate({ incidentId: row.incident.id, status: "confirmed" })}><CheckCircle2 size={16} /></button><button aria-label="Reject incident" title="Reject incident" onClick={() => reviewIncident.mutate({ incidentId: row.incident.id, status: "rejected" })}><XCircle size={16} /></button></div> : <span className="incident-reviewed">{row.incident.reviewedAt ? "Reviewed" : "Operator only"}</span>}</div>)}</div> : <div className="operations-empty"><CircleAlert size={18} /> No persisted incidents match this filter.</div>}
            </div>
          </>}
        </div>
      </section>

      {showDemo && (
        <div className="demo-overlay" role="dialog" aria-modal="true" aria-label="Request a demo">
          <div className="demo-dialog">
            <button className="dialog-close" onClick={() => setShowDemo(false)} aria-label="Close"><X size={20} /></button>
            <div className="dialog-icon"><Sparkles size={22} /></div>
            {!demoSent ? <form className="demo-form" onSubmit={(event) => { event.preventDefault(); setDemoSent(true); }}><h3>Let’s talk.</h3><p>Tell us where to send the RSD walkthrough and we’ll prepare a tailored operational demo.</p><input required type="text" placeholder="Your name" aria-label="Your name" /><input required type="email" placeholder="Work email" aria-label="Work email" /><button className="primary-btn" type="submit">Request my demo <ArrowLeft size={18} /></button></form> : <div className="demo-success"><div className="dialog-icon"><Check size={22} /></div><h3>Request received.</h3><p>Thanks. Your demo request has been captured for the RSD team.</p><button className="primary-btn" type="button" onClick={() => setShowDemo(false)}>Close <Check size={18} /></button></div>}
          </div>
        </div>
      )}
    </main>
  );
}
