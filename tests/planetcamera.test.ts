import * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import { PlanetCamera, wrapAngle } from "../src/render/planetCamera";

const make = (surface: (d: THREE.Vector3) => number) =>
  new PlanetCamera(new THREE.PerspectiveCamera(42, 1.6, 0.5, 9000), 40, surface, { invertZoom: () => false, edgeScroll: () => false, key: () => "none" });

describe("planet camera", () => {
  it("panning straight over a pole does not spin the view", () => {
    const cam = make(() => 40);
    cam.lookAt(new THREE.Vector3(0.3, 0.95, 0.1), 20);
    cam.update(0.016);
    const fwd = () => new THREE.Vector3(0, 0, -1).applyQuaternion(cam.camera.quaternion);
    const screenUp = () => cam.camera.up.clone();
    let last = screenUp();
    let worst = 0;
    for (let i = 0; i < 400; i++) {
      cam.pan(0, 6, 900);
      cam.update(0.016);
      const u = screenUp();
      worst = Math.max(worst, u.angleTo(last));
      last = u;
    }
    expect(fwd().length()).toBeGreaterThan(0.99);
    expect(cam.focus.y).toBeLessThan(0.95); // it did travel across the pole
    expect(worst).toBeLessThan(0.2);
  });

  it("does not bob the camera when the ground height jumps", () => {
    let h = 40;
    const cam = make(() => h);
    cam.update(0.016);
    const before = cam.camera.position.length();
    h = 44;
    cam.update(0.016);
    expect(Math.abs(cam.camera.position.length() - before)).toBeLessThan(1);
  });
});

describe("tilting to nadir", () => {
  it("keeps the view steady while tilting straight down at any heading", () => {
    for (const heading of [0, 1.3, 3.1, -2.4]) {
      const cam = make(() => 40);
      cam.lookAt(new THREE.Vector3(0, 1, 0), 60);
      cam.snap(60, heading, 0);
      cam.update(0.016);
      let last = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.camera.quaternion);
      let worst = 0;
      for (let i = 0; i < 200; i++) {
        cam.tilt(-0.01);
        cam.update(0.016);
        const u = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.camera.quaternion);
        worst = Math.max(worst, u.angleTo(last));
        last = u;
      }
      expect(cam.pitch()).toBeLessThan(0.05);
      expect(worst).toBeLessThan(0.05);
    }
  });

  it("wraps the two-finger angle so crossing horizontal does not spin the view", () => {
    expect(wrapAngle(-Math.PI * 2 + 0.1)).toBeCloseTo(0.1);
    expect(wrapAngle(Math.PI * 2 - 0.1)).toBeCloseTo(-0.1);
    expect(wrapAngle(0.4)).toBeCloseTo(0.4);
  });
});
