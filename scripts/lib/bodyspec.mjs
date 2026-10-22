// What each body is made of: the MakeHuman macro settings and the region targets (all CC0, targets/ in the GitHub repo).
// Used by scripts/build-surfers.mjs and scripts/measure-body.mjs.
//
// A target is [path under targets/ without ".target", weight 0..1]. "{s}" expands to the left and right files ("l-", "r-").
// Every weight was chosen by measuring the built mesh (scripts/lib/measure.mjs), see _reports/m3-good-looking.md.
export const RACE = { caucasian: 0.42, african: 0.3, asian: 0.28 };

// Milestone 2 shapes (muscle 0.78 / weight 0.22 male, 0.66 / 0.26 female, no region targets): the "before" of milestone 3.
export const BASELINE = {
  male: { muscle: 0.78, weight: 0.22, targets: [] },
  female: { muscle: 0.66, weight: 0.26, targets: [] },
};

// Faces. Weights are large because the face targets move vertices by 1 to 12 mm at weight 1 (measured with a probe over the
// target files: eye targets peak at 2 to 3 mm, the chin at 12 mm). Male: strong jaw and chin, defined cheekbones, straight
// nose, level brow, lips neither thin nor full. Female: defined cheekbones, softer jaw, almond eyes, a straight or slightly
// upturned nose, full lips. Both are built symmetric (every side target is applied left and right at the same weight).
const FACE_MALE = [
  ["head/head-square", 0.5],
  ["chin/chin-prominent-incr", 0.8],
  ["chin/chin-width-incr", 0.5],
  ["chin/chin-prognathism-incr", 0.3],
  ["cheek/{s}-cheek-bones-incr", 0.9],
  ["cheek/{s}-cheek-volume-decr", 0.3],
  ["nose/nose-greek-incr", 0.6],
  ["nose/nose-hump-decr", 0.5],
  ["nose/nose-width1-decr", 0.5],
  ["nose/nose-width2-decr", 0.3],
  ["nose/nose-width3-decr", 0.3],
  ["forehead/forehead-trans-forward", 0.3],
  ["eyes/{s}-eye-scale-incr", 0.4],
  ["eyes/{s}-eye-height1-incr", 0.3],
  ["eyes/{s}-eye-height2-incr", 0.3],
  ["eyes/{s}-eye-bag-decr", 0.5],
  ["eyebrows/eyebrows-trans-down", 0.5],
  ["mouth/mouth-lowerlip-volume-incr", 0.4],
  ["mouth/mouth-upperlip-volume-incr", 0.2],
  ["mouth/mouth-scale-horiz-incr", 0.3],
  ["mouth/mouth-angles-up", 0.25],
  ["ears/{s}-ear-scale-decr", 0.3],
  ["ears/{s}-ear-wing-decr", 0.4],
  ["neck/neck-scale-horiz-incr", 0.3],
];
const FACE_FEMALE = [
  ["head/head-oval", 0.7],
  ["chin/chin-width-decr", 0.5],
  ["chin/chin-prominent-decr", 0.2],
  ["chin/chin-triangle", 0.1],
  ["cheek/{s}-cheek-bones-incr", 1],
  ["cheek/{s}-cheek-volume-decr", 0.3],
  ["eyes/{s}-eye-scale-incr", 0.4],
  ["eyes/{s}-eye-height1-incr", 0.3],
  ["eyes/{s}-eye-height2-incr", 0.3],
  ["eyes/{s}-eye-corner1-up", 0.8],
  ["eyes/{s}-eye-bag-decr", 0.5],
  ["nose/nose-scale-vert-decr", 0.4],
  ["nose/nose-point-up", 0.3],
  ["nose/nose-width1-decr", 0.6],
  ["nose/nose-width3-decr", 0.5],
  ["nose/nose-nostrils-width-decr", 0.5],
  ["nose/nose-hump-decr", 0.5],
  ["mouth/mouth-upperlip-volume-incr", 0.5],
  ["mouth/mouth-lowerlip-volume-incr", 0.6],
  ["mouth/mouth-cupidsbow-incr", 0.5],
  ["mouth/mouth-scale-horiz-incr", 0.2],
  ["mouth/mouth-angles-up", 0.3],
  ["eyebrows/eyebrows-trans-down", 0.3],
  ["ears/{s}-ear-scale-decr", 0.3],
];

export const SHAPES = {
  male: {
    muscle: 0.7,
    weight: 0.45,
    targets: [
      ["torso/torso-muscle-dorsi-incr", 1],
      ["torso/torso-muscle-pectoral-incr", 1],
      ["torso/torso-scale-depth-incr", 0.4],
      ["measure/measure-shoulder-dist-incr", 0.4],
      ["measure/measure-upperarm-length-decr", 0.5],
      ["measure/measure-lowerarm-length-decr", 0.4],
      ["armslegs/{s}-hand-scale-decr", 0.3],
      ["measure/measure-upperarm-circ-incr", 0.3],
      ["armslegs/{s}-upperarm-muscle-incr", 0.4],
      ["armslegs/{s}-lowerarm-muscle-incr", 0.6],
      ["armslegs/{s}-lowerarm-fat-incr", 0.3],
      ["measure/measure-thigh-circ-incr", 0.5],
      ["armslegs/{s}-upperleg-muscle-incr", 0.5],
      ["armslegs/{s}-lowerleg-muscle-incr", 0.6],
      ...FACE_MALE,
    ],
  },
  female: {
    muscle: 0.6,
    weight: 0.34,
    targets: [
      ["torso/torso-muscle-dorsi-incr", 0.5],
      ["measure/measure-bust-circ-incr", 0.3],
      // 0.7 (was 0.3) cancels torso-scale-horiz-decr below, which also narrows the shoulders: shoulder joints 0.202 -> 0.203 of height
      ["measure/measure-shoulder-dist-incr", 0.7],
      ["measure/measure-upperarm-circ-incr", 0.2],
      ["armslegs/{s}-upperarm-muscle-incr", 0.4],
      ["armslegs/{s}-lowerarm-muscle-incr", 0.8],
      ["armslegs/{s}-upperleg-muscle-incr", 0.3],
      ["armslegs/{s}-lowerleg-muscle-incr", 0.4],
      ["buttocks/buttocks-volume-decr", 0.5],
      // Slim, toned waist and a flat stomach (Ed, 2026-10-21: "she looks fat around the waist"), then (same day) "front flat, back
      // as the original": measure-waist-circ-decr shrank the whole circumference and pulled the lower back in, so it is not used.
      // stomach-pregnant-decr and stomach-tone-incr move the front only (back unchanged to 0.0001 of height); torso-scale-horiz-decr
      // takes the width (the love handles) at 0.58 to 0.62 of height and leaves depth alone. Measured by scripts/measure-waist.mjs:
      // lower-back depth equals the milestone-3 body; front depth and side width are within 0.003 of height of the first slimmed body.
      ["stomach/stomach-pregnant-decr", 1],
      ["stomach/stomach-tone-incr", 1],
      ["torso/torso-scale-horiz-decr", 0.27],
      ["measure/measure-upperarm-length-incr", 0.2],
      ["measure/measure-lowerarm-length-incr", 0.15],
      ...FACE_FEMALE,
    ],
  },
};
