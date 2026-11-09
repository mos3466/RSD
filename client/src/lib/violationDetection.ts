export type DetectionLike = { label: string; score: number; x?: number; y?: number };

export function isDrinkingAction(input: {
  objectCenterX: number;
  objectCenterY: number;
  objectWidth: number;
  objectHeight: number;
  personX: number;
  personY: number;
  personWidth: number;
  personHeight: number;
  nose?: { x: number; y: number };
  wrists: Array<{ x: number; y: number }>;
}) {
  const insidePerson = input.objectCenterX >= input.personX - input.personWidth * 0.08
    && input.objectCenterX <= input.personX + input.personWidth * 1.08
    && input.objectCenterY >= input.personY
    && input.objectCenterY <= input.personY + input.personHeight * 0.82;
  if (!insidePerson) return false;

  const faceDistance = input.nose
    ? Math.hypot(input.objectCenterX - input.nose.x, input.objectCenterY - input.nose.y)
    : Number.POSITIVE_INFINITY;
  const handDistance = input.wrists.reduce((best, wrist) => Math.min(best, Math.hypot(input.objectCenterX - wrist.x, input.objectCenterY - wrist.y)), Number.POSITIVE_INFINITY);
  const maxFaceDistance = input.personHeight * 0.23;
  const maxHandDistance = Math.max(input.objectWidth, input.objectHeight) * 2.4;
  return faceDistance <= maxFaceDistance || handDistance <= maxHandDistance;
}

export function isReliableFloorSitting(input: {
  personScore: number;
  personHeight: number;
  videoHeight: number;
  poseConfidence: number;
  shoulderY: number;
  hipY: number;
  kneeY: number;
  ankleY: number;
  hasDrinkObject: boolean;
}) {
  if (input.hasDrinkObject) return false;
  if (input.personScore < 0.45 || input.poseConfidence < 0.68) return false;
  if (input.personHeight <= input.videoHeight * 0.28) return false;
  return input.hipY > input.shoulderY + input.videoHeight * 0.16
    && input.kneeY > input.hipY - input.videoHeight * 0.08
    && input.ankleY > input.videoHeight * 0.68;
}

const foodPriority = ["bottle", "cup", "banana", "apple", "sandwich", "orange", "bowl", "cake", "donut", "hot dog", "pizza"];

export function prioritizeDetections<T extends DetectionLike>(detections: T[]) {
  const sorted = [...detections].sort((left, right) => {
    const leftIndex = foodPriority.indexOf(left.label);
    const rightIndex = foodPriority.indexOf(right.label);
    return (leftIndex === -1 ? 99 : leftIndex) - (rightIndex === -1 ? 99 : rightIndex);
  });
  const seen = new Set<string>();
  const kept: T[] = [];
  return sorted.filter((item) => {
    const duplicate = kept.some((previous) => previous.label === item.label
      && item.x !== undefined && item.y !== undefined
      && previous.x !== undefined && previous.y !== undefined
      && Math.hypot(previous.x - item.x, previous.y - item.y) < 8);
    if (duplicate) return false;
    kept.push(item);
    if (item.x === undefined || item.y === undefined) {
      if (seen.has(item.label)) return false;
      seen.add(item.label);
    }
    return true;
  });
}
