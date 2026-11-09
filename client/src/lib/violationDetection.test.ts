import { describe, expect, it } from "vitest";
import { isDrinkingAction, isReliableFloorSitting, prioritizeDetections } from "./violationDetection";

describe("violation detection safeguards", () => {
  const strongSeatedPose = {
    personScore: 0.92,
    personHeight: 420,
    videoHeight: 600,
    poseConfidence: 0.86,
    shoulderY: 120,
    hipY: 280,
    kneeY: 300,
    ankleY: 500,
    hasDrinkObject: false,
  };

  it("does not call a scene floor-sitting when a cup or bottle is present", () => {
    expect(isReliableFloorSitting({ ...strongSeatedPose, hasDrinkObject: true })).toBe(false);
  });

  it("requires a strong body pose before reporting floor sitting", () => {
    expect(isReliableFloorSitting({ ...strongSeatedPose, poseConfidence: 0.52 })).toBe(false);
    expect(isReliableFloorSitting({ ...strongSeatedPose, hipY: 205 })).toBe(false);
    expect(isReliableFloorSitting(strongSeatedPose)).toBe(true);
  });

  it("prioritizes detected food or drink objects over a weaker pose label", () => {
    const sorted = prioritizeDetections([
      { label: "sitting on the floor", score: 92 },
      { label: "cup", score: 71 },
    ]);
    expect(sorted[0].label).toBe("cup");
    expect(prioritizeDetections([
      { label: "cup", score: 71 },
      { label: "cup", score: 64 },
    ])).toHaveLength(1);
    expect(prioritizeDetections([
      { label: "cup", score: 71, x: 20, y: 20 },
      { label: "cup", score: 76, x: 80, y: 20 },
    ])).toHaveLength(2);
  });

  it("requires the cup to be near the face or hand before calling it drinking", () => {
    const base = {
      objectCenterX: 200,
      objectCenterY: 220,
      objectWidth: 40,
      objectHeight: 60,
      personX: 100,
      personY: 80,
      personWidth: 240,
      personHeight: 420,
      nose: { x: 205, y: 215 },
      wrists: [{ x: 210, y: 220 }],
    };
    expect(isDrinkingAction(base)).toBe(true);
    expect(isDrinkingAction({ ...base, objectCenterX: 390, objectCenterY: 500 })).toBe(false);
  });
});
