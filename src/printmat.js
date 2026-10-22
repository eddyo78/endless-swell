import * as THREE from "three";

// Materials that draw a print mask (src/printart.js) in two colours.
//
// The mask is the material's `map`. The shader reads one channel of it as "how much of the second colour" and mixes the item's
// two colours per pixel, in linear light, after the cloth gains (src/surfer.js clothComp) have been applied to each colour on
// the CPU. Nothing else in the lighting changes: the mixed colour is the diffuse colour, as the old vertex colours were.
//
//   garment  geometry from src/printuv.js: `uv` (u turns round a part, v metres from its hem), `printRegion` (which part, 0 to 4,
//            plus 8 times the neighbouring part on a seam), `printUvB` and `printPhi` (the neighbour's UV and the signed field whose
//            zero line is the seam: the shader draws this part where it is positive and the neighbour where negative) and
//            `printTrim` (1 on the hem bands, which are always the second colour). uPrintM[region] turns the stored UV into tile
//            coordinates for the pattern in use (regionTransforms), so one geometry serves every pattern.
//   board    geometry from src/board.js: planform `uv`, `railArc` (metres to the nearer rail apex) and `deckSide`. The rail band
//            is drawn here, as a line of constant width, anti-aliased with the screen-space derivative; the underside is a touch
//            darker, as before.

export const PRINT_REGIONS = 5;
// Cloth light is capped by a soft shoulder (luminance, linear HDR before tone mapping): above CLOTH_KNEE it rolls off toward
// CLOTH_CEILING and never reaches it. The cloth gains (src/surfer.js clothComp) lift a white to the HDR level that ACES tone
// mapping turns back into white, and in full sun that level passed the bloom threshold (2.4, src/scene.js), so every white
// garment spread a glow over its own back and the water round it (measured: the pixels within 10 px of a white rashguard
// brightened by 50 levels; 13% of the garment was clipped to 250+). The ceiling is under the threshold, so cloth feeds no
// bloom, and at 2.2 the tone-mapped white is within a few levels of the colour's hex, so the colour check still holds.
export const CLOTH_KNEE = 1.5;
export const CLOTH_CEILING = 2.2;
export const RAIL_HALF_WIDTH = 0.011; // metres either side of the rail apex: a 2.2 cm band

/** A cloth material (roughness and metalness as the old vertex-colour materials had them). */
export function createGarmentMaterial(roughness, metalness = 0.02) {
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness,
    metalness,
    specularIntensity: 0.05,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const uniforms = {
    uPrintA: { value: new THREE.Color(1, 1, 1) },
    uPrintB: { value: new THREE.Color(1, 1, 1) },
    uPrintM: { value: Array.from({ length: PRINT_REGIONS }, () => new THREE.Vector4(1, 0, 0, 1)) },
  };
  material.userData.print = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         attribute vec2 printUvB;
         attribute float printRegion;
         attribute float printPhi;
         attribute float printTrim;
         varying float vPrintTrim;
         varying float vPrintPhi;
         varying vec2 vMapUvB;
         uniform vec4 uPrintM[${PRINT_REGIONS}];`,
      )
      .replace(
        "#include <uv_vertex>",
        `#include <uv_vertex>
         vPrintTrim = printTrim;
         vPrintPhi = printPhi;
         #ifdef USE_MAP
           float printRegionB = floor(printRegion / 8.0);
           vec4 printMA = uPrintM[int(printRegion - printRegionB * 8.0 + 0.5)];
           vec4 printMB = uPrintM[int(printRegionB + 0.5)];
           vMapUv = vec2(printMA.x * uv.x + printMA.y * uv.y, printMA.z * uv.x + printMA.w * uv.y);
           vMapUvB = vec2(printMB.x * printUvB.x + printMB.y * printUvB.y, printMB.z * printUvB.x + printMB.w * printUvB.y);
         #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         varying float vPrintTrim;
         varying float vPrintPhi;
         varying vec2 vMapUvB;
         uniform vec3 uPrintA;
         uniform vec3 uPrintB;`,
      )
      .replace(
        "#include <map_fragment>",
        `float printMask = 0.0;
         #ifdef USE_MAP
           vec2 printGradX = dFdx( vMapUvB );
           vec2 printGradY = dFdy( vMapUvB );
           printMask = texture2D( map, vMapUv ).r;
           float printCover = clamp( vPrintPhi / ( fwidth( vPrintPhi ) + 1e-5 ) + 0.5, 0.0, 1.0 );
           if ( printCover < 1.0 ) printMask = mix( textureGrad( map, vMapUvB, printGradX, printGradY ).r, printMask, printCover );
         #endif
         float printK = max(printMask * (1.0 - vPrintTrim), vPrintTrim);
         diffuseColor.rgb *= mix(uPrintA, uPrintB, printK);`,
      )
      .replace(
        "#include <opaque_fragment>",
        `#include <opaque_fragment>
         float clothLum = dot( gl_FragColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
         if ( clothLum > ${CLOTH_KNEE.toFixed(3)} ) {
           float clothRoom = ${(CLOTH_CEILING - CLOTH_KNEE).toFixed(3)};
           float clothShaped = ${CLOTH_KNEE.toFixed(3)} + clothRoom * ( 1.0 - exp( -( clothLum - ${CLOTH_KNEE.toFixed(3)} ) / clothRoom ) );
           gl_FragColor.rgb *= clothShaped / clothLum;
         }`,
      );
  };
  material.customProgramCacheKey = () => "print-garment";
  return material;
}

/** The board hull material. */
export function createBoardMaterial() {
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.7,
    clearcoat: 0,
    specularIntensity: 0.2,
  });
  const uniforms = {
    uPrintA: { value: new THREE.Color(1, 1, 1) },
    uPrintB: { value: new THREE.Color(1, 1, 1) },
    uRailHalf: { value: RAIL_HALF_WIDTH },
  };
  material.userData.print = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         attribute float railArc;
         attribute float deckSide;
         varying float vRailArc;
         varying float vDeckSide;`,
      )
      .replace(
        "#include <uv_vertex>",
        `#include <uv_vertex>
         vRailArc = railArc;
         vDeckSide = deckSide;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         varying float vRailArc;
         varying float vDeckSide;
         uniform vec3 uPrintA;
         uniform vec3 uPrintB;
         uniform float uRailHalf;`,
      )
      .replace(
        "#include <map_fragment>",
        `float printMask = 0.0;
         #ifdef USE_MAP
           printMask = texture2D( map, vMapUv ).r;
         #endif
         float railEdge = max(fwidth(vRailArc), 1e-5);
         float railBand = 1.0 - smoothstep(uRailHalf - railEdge, uRailHalf + railEdge, vRailArc);
         float printK = max(printMask, railBand);
         diffuseColor.rgb *= mix(uPrintA, uPrintB, printK) * (0.88 + 0.12 * vDeckSide);`,
      );
  };
  material.customProgramCacheKey = () => "print-board";
  return material;
}
