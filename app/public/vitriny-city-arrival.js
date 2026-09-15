// A street-facing arrival makes entrances and people readable. Saved visitor
// checkpoints remain authoritative; this preset is only for a fresh arrival.
export function cityArrivalPose({active = true, mobile = false, panoramic = false} = {}) {
  if (!active) return {x: 0, y: 38, z: 132, yaw: Math.PI, pitch: .14};
  return panoramic
    ? {x: -164, y: 27, z: 235, yaw: Math.PI, pitch: -.16}
    : {x: -164, y: mobile ? 7.8 : 9.2, z: 229, yaw: Math.PI, pitch: .045};
}

export function cityWalkingPose({active = true} = {}) {
  return active
    ? {x: -164, y: 2.2, z: 145, yaw: Math.PI, pitch: .035}
    : {x: 23, y: 2.2, z: 53, yaw: Math.PI - .4, pitch: .035};
}
