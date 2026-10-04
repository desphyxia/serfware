import * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import { PlanetCamera } from "../src/render/planetCamera";

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
