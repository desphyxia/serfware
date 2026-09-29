import * as THREE from "three";

/**
 * Sea surface: depth-tinted colour, animated ripples, sun glint, Fresnel sky reflection and
 * shore foam that laps in and out. Depth comes from the terrain via the aDepth attribute.
 */
export function makeWaterMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uSunColor: { value: new THREE.Color("#fff1dc") },
      uSky: { value: new THREE.Color("#8fb6d8") },
      uDay: { value: 1 },
      uFogColor: { value: new THREE.Color("#000000") },
      uFogNear: { value: 1e6 },
      uFogFar: { value: 2e6 },
    },
    vertexShader: /* glsl */ `
      attribute float aDepth;
      attribute float aFog;
      varying float vFog;
      varying float vDepth;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vViewZ;
      void main() {
        vDepth = aDepth;
        vFog = aFog;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vNormal = normalize(w.xyz);
        vec4 mv = viewMatrix * w;
        vViewZ = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uSky; uniform float uDay;
      uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar;
      varying float vDepth; varying vec3 vWorld; varying vec3 vNormal; varying float vViewZ; varying float vFog;

      float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float noise(vec3 x) {
        vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
      }
      void main() {
        vec3 n = normalize(vNormal);
        // Ripples: perturb the normal with two drifting noise layers.
        vec3 p = vWorld * 0.35;
        float t = uTime * 0.35;
        float e = 0.08;
        float n1 = noise(p + vec3(t, 0.0, t * 0.7));
        float n2 = noise(p * 2.3 - vec3(t * 0.6, t, 0.0));
        vec3 grad = vec3(noise(p + vec3(e, 0, 0) + vec3(t, 0, t * 0.7)) - n1,
                         noise(p + vec3(0, e, 0) + vec3(t, 0, t * 0.7)) - n1,
                         noise(p + vec3(0, 0, e) + vec3(t, 0, t * 0.7)) - n1) / e;
        grad += (vec3(noise(p * 2.3 + vec3(e, 0, 0) - vec3(t * 0.6, t, 0)), noise(p * 2.3 + vec3(0, e, 0) - vec3(t * 0.6, t, 0)), noise(p * 2.3 + vec3(0, 0, e) - vec3(t * 0.6, t, 0))) - n2) / e * 0.5;
        grad -= n * dot(grad, n);
        vec3 N = normalize(n - grad * 0.06);

        vec3 V = normalize(cameraPosition - vWorld);
        vec3 L = normalize(uSunDir);
        float sunUp = clamp(dot(n, L) * 3.0 + 0.2, 0.0, 1.0);
        float depth = max(vDepth, 0.0);
        vec3 shallow = vec3(0.30, 0.62, 0.62);
        vec3 deep = vec3(0.05, 0.20, 0.32);
        vec3 base = mix(shallow, deep, smoothstep(0.0, 3.5, depth));
        float diff = max(dot(N, L), 0.0);
        vec3 col = base * (0.18 + 0.82 * diff * sunUp) * mix(0.35, 1.0, uDay);
        float fres = pow(1.0 - max(dot(N, V), 0.0), 5.0);
        col = mix(col, uSky * mix(0.25, 1.0, uDay), fres * 0.55);
        vec3 H = normalize(L + V);
        float spec = pow(max(dot(N, H), 0.0), 320.0) * sunUp;
        col += uSunColor * spec * 0.9;
        // Shore foam: bands that travel toward the coast.
        float shore = 1.0 - smoothstep(0.0, 0.45, depth);
        float bands = smoothstep(0.55, 0.95, sin(depth * 9.0 - uTime * 1.6 + n1 * 4.0) * 0.5 + 0.5);
        float foam = clamp(shore * (0.35 + bands * 0.65) * (0.6 + n2 * 0.6), 0.0, 1.0);
        col = mix(col, vec3(0.93, 0.95, 0.92) * mix(0.35, 1.0, sunUp), foam * 0.6);
        float alpha = mix(0.55, 0.93, smoothstep(0.0, 2.0, depth));
        alpha = max(alpha, foam * 0.7);
        col = mix(col, col * 0.1 + vec3(0.01, 0.015, 0.03), smoothstep(0.55, 1.0, vFog));
        float fog = smoothstep(uFogNear, uFogFar, vViewZ);
        col = mix(col, uFogColor, fog);
        gl_FragColor = vec4(col, alpha);
        #include <colorspace_fragment>
      }`,
  });
}
