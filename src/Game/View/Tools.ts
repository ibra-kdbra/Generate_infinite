import * as THREE from 'three'

import View from './View'
import State from '../State/State'
import Settings from '../Settings'
import { PLANT, Plant } from '../State/Vegetation'
import { WATER_LEVEL } from '../Workers/TerrainShape'
import { createCover, createPouch, createQuiver, createSack, createTool, createToolMaterials, createArrowGeometry, createClimbingAxe, ToolName, ToolMaterials } from './ToolModels'
import { GRIP_LEFT, GRIP_RIGHT, HandTarget, ToolPose } from './CharacterPose'
import Trail from './Trail'

// Three tools per outfit: the ranger's and the farmer's
const SETS: Record<'ranger' | 'peasant', ToolName[]> = {
    ranger: ['sword', 'bow', 'torch'],
    peasant: ['axe', 'hoe', 'sickle']
}
export const TOOL_LABELS: Record<ToolName, string> = { sword: 'Sword', bow: 'Bow', torch: 'Torch', axe: 'Axe', hoe: 'Hoe', sickle: 'Sickle' }
const ACTIONS: Record<ToolName, string> = {
    sword: 'Strike, again for the next move · Q heavy',
    bow: 'Hold to draw · release to shoot',
    torch: 'Hold to raise the torch',
    axe: 'Chop, again for the next move · Q heavy',
    hoe: 'Dig, again for the next move · Q heavy',
    sickle: 'Reap, again for the next move · Q heavy'
}
export const TOOL_ICONS: Record<ToolName, string> = {
    sword: '<path d="M19.5 4.5 9.5 14.5"/><path d="M19.5 4.5h-3.2M19.5 4.5v3.2"/><path d="m7 12 5 5"/><path d="m8.5 15.5-4 4"/>',
    bow: '<path d="M6.5 3.5c9 3 9 14 0 17"/><path d="M6.5 3.5v17"/><path d="M3.5 12h15"/><path d="m15.5 9 3 3-3 3"/>',
    torch: '<path d="M10.2 11h3.6L13 20.5h-2z"/><path d="M12 3c2.6 2.4 2.6 5.4 0 7-2.6-1.6-2.6-4.6 0-7z"/>',
    axe: '<path d="M5.5 20 15 7"/><path d="M12.4 6.6c2.6-2.9 6.5-2.4 7.6.3l-4.4 3.3z"/>',
    hoe: '<path d="M5 20 16.5 6.5"/><path d="m14.5 4.5 5 5-2.4 1.6"/>',
    sickle: '<path d="m6 20 3.4-4.2"/><path d="M9.4 15.8C4.6 10.4 9.6 3.4 17.8 4.4c-5 1.6-7.4 5.4-5.6 10"/>'
}

type V3 = [number, number, number]
// One key pose of a stroke, in the character's own space (x left, y up, z forward, from the
// feet, moving with the body when it crouches): the right hand's grip, the tool's direction
// (handle toward its working end), optionally the way its edge faces (otherwise the edge
// leads the motion), the chest's turn and lean, how far the knees bend. `ease` shapes the
// way into this key: 'in' accelerates (a strike into the hit), 'out' slows (follow-through).
type Key = { t: number, grip: V3, dir: V3, edge?: V3, twist?: number, lean?: number, lower?: number, ease?: 'in' | 'out' | 'inout' }
type Kind = 'blade' | 'chop' | 'dig' | 'reap'
type Step = 'forward' | 'back' | 'left' | 'right'
type Swing = {
    keys: Key[]                  // the first is replaced by wherever the hands are, the last by the carry
    active: [number, number]     // when it can hit something
    kind: Kind
    step?: [number, number, Step?]   // a step with the strike: when, speed (m/s), which way (forward)
    chain?: number               // from here a new press (or the held button) goes on to the next stroke
    special?: 'plunge' | 'spin' | 'leap' | 'hop'   // the body does more than step (see updateSwing)
}

/**
 * A direction turned from `from` to `to` (unit vectors) by u along a great circle: the short
 * way, except when they're nearly opposite and the short way passes below (a blade raised
 * from the hip to over the shoulder goes up in front, not down between the legs).
 */
function arcBetween(from: THREE.Vector3, to: THREE.Vector3, u: number) {
    const turn = (a: THREE.Vector3, b: THREE.Vector3, x: number) => a.clone().applyQuaternion(new THREE.Quaternion().slerp(new THREE.Quaternion().setFromUnitVectors(a, b), x))
    if (from.angleTo(to) < 2.6)
        return turn(from, to, u)
    const mid = from.clone().add(to)
    if (mid.lengthSq() < 1e-6)
        mid.copy(UP).addScaledVector(from, - UP.dot(from))       // exactly opposite: over the top
    else if (mid.y < - 0.05)
        mid.negate()                                             // the long way round, above
    if (mid.lengthSq() < 1e-6)
        mid.set(0, 0, 1)
    mid.normalize()
    return u < 0.5 ? turn(from, mid, u * 2) : turn(mid, to, u * 2 - 1)
}

const START: Key = { t: 0, grip: [0, 0, 0], dir: [0, 1, 0] }
const END = (t: number): Key => ({ t, grip: [0, 0, 0], dir: [0, 1, 0] })

/**
 * The strokes, by name. The sword has a swordsman's set:
 *  - a five-stroke combo (press again in time, or hold): forehand diagonal, rising backhand,
 *    level cut, lunging thrust, overhead finisher
 *  - by what the body is doing: a running rising cut (sprinting), a plunging cut (in the
 *    air), a low sweep (crouching), a retreating slash (holding back), side-step cuts
 *    (holding left or right)
 *  - heavy (Q or the right button): a full spin, a leaping overhead slam (moving forward), a
 *    rising uppercut (crouching)
 */
const SWINGS: Partial<Record<ToolName, Record<string, Swing>>> = {
    sword: {
        forehand: {
            keys: [START,
                { t: 0.13, grip: [- 0.38, 1.5, 0.02], dir: [- 0.35, 0.55, - 0.76], twist: - 0.55, lean: - 0.05 },
                { t: 0.21, grip: [- 0.1, 1.22, 0.52], dir: [0.45, 0.25, 0.86], twist: 0.1, lean: 0.12, ease: 'in' },
                { t: 0.29, grip: [0.16, 0.98, 0.38], dir: [0.82, - 0.5, 0.28], twist: 0.55, lean: 0.2, ease: 'out' },
                END(0.6)], active: [0.15, 0.28], kind: 'blade', step: [0.12, 3.2], chain: 0.27
        },
        backhand: {
            keys: [START,
                { t: 0.09, grip: [0.26, 1.0, 0.2], dir: [0.75, 0.05, - 0.66], twist: 0.7, lean: 0.15 },
                { t: 0.17, grip: [0.02, 1.2, 0.55], dir: [- 0.45, 0.3, 0.84], lean: 0.08, ease: 'in' },
                { t: 0.25, grip: [- 0.34, 1.4, 0.28], dir: [- 0.85, 0.45, - 0.27], twist: - 0.55, lean: - 0.05, ease: 'out' },
                END(0.58)], active: [0.11, 0.24], kind: 'blade', step: [0.07, 2.6], chain: 0.24
        },
        level: {
            keys: [START,
                { t: 0.11, grip: [- 0.42, 1.12, 0.16], dir: [- 0.78, 0.05, - 0.62], twist: - 0.7, lean: 0.05 },
                { t: 0.2, grip: [- 0.05, 1.1, 0.55], dir: [0.25, 0, 0.97], lean: 0.12, ease: 'in' },
                { t: 0.29, grip: [0.3, 1.08, 0.28], dir: [0.9, - 0.05, - 0.42], twist: 0.75, lean: 0.1, ease: 'out' },
                END(0.58)], active: [0.13, 0.29], kind: 'blade', step: [0.1, 2.4], chain: 0.28
        },
        thrust: {
            keys: [START,
                { t: 0.14, grip: [- 0.28, 1.22, - 0.1], dir: [0.05, 0.05, 1], edge: [0, - 1, 0], twist: - 0.45, lean: - 0.08 },
                { t: 0.22, grip: [- 0.08, 1.28, 0.62], dir: [0.02, 0, 1], edge: [0, - 1, 0], twist: 0.25, lean: 0.25, lower: 0.1, ease: 'in' },
                { t: 0.31, grip: [- 0.08, 1.27, 0.6], dir: [0.02, 0.02, 1], edge: [0, - 1, 0], twist: 0.25, lean: 0.25, lower: 0.1 },
                END(0.6)], active: [0.17, 0.31], kind: 'blade', step: [0.15, 4.4], chain: 0.3
        },
        overhead: {
            keys: [START,
                { t: 0.2, grip: [- 0.12, 1.76, 0.04], dir: [0, 0.45, - 0.89], twist: - 0.15, lean: - 0.15 },
                { t: 0.29, grip: [- 0.06, 1.32, 0.56], dir: [0.02, 0.35, 0.94], twist: 0.05, lean: 0.2, lower: 0.08, ease: 'in' },
                { t: 0.37, grip: [- 0.04, 0.92, 0.48], dir: [0.02, - 0.55, 0.83], twist: 0.08, lean: 0.38, lower: 0.15, ease: 'out' },
                END(0.76)], active: [0.25, 0.37], kind: 'blade', step: [0.22, 3.8], chain: 0.4
        },
        running: {
            keys: [START,
                { t: 0.08, grip: [- 0.4, 0.95, 0.15], dir: [- 0.6, - 0.4, - 0.7], twist: - 0.6, lean: 0.25 },
                { t: 0.18, grip: [- 0.02, 1.25, 0.6], dir: [0.4, 0.55, 0.73], twist: 0.2, lean: 0.2, ease: 'in' },
                { t: 0.28, grip: [0.25, 1.5, 0.3], dir: [0.75, 0.6, 0.25], twist: 0.6, ease: 'out' },
                END(0.62)], active: [0.1, 0.27], kind: 'blade', step: [0.06, 7.5]
        },
        plunge: {
            keys: [START,
                { t: 0.12, grip: [- 0.1, 1.75, 0.05], dir: [0, 0.5, - 0.86], twist: - 0.1, lean: - 0.2 },
                { t: 0.24, grip: [- 0.05, 1.0, 0.55], dir: [0, - 0.6, 0.8], lean: 0.45, lower: 0.2, ease: 'in' },
                { t: 0.36, grip: [- 0.05, 0.85, 0.5], dir: [0, - 0.8, 0.6], lean: 0.5, lower: 0.3, ease: 'out' },
                END(0.72)], active: [0.14, 0.36], kind: 'blade', special: 'plunge'
        },
        sweep: {
            keys: [START,
                { t: 0.12, grip: [- 0.45, 0.62, 0.2], dir: [- 0.6, - 0.25, 0.75], twist: - 0.6, lean: 0.45, lower: 0.3 },
                { t: 0.3, grip: [0.38, 0.58, 0.3], dir: [0.7, - 0.3, 0.65], twist: 0.6, lean: 0.45, lower: 0.3 },
                END(0.62)], active: [0.12, 0.3], kind: 'blade'
        },
        retreat: {
            keys: [START,
                { t: 0.1, grip: [0.2, 0.95, 0.3], dir: [0.7, - 0.3, 0.6], twist: 0.5, lean: 0.15 },
                { t: 0.2, grip: [- 0.15, 1.3, 0.45], dir: [- 0.4, 0.6, 0.7], twist: - 0.2, ease: 'in' },
                { t: 0.3, grip: [- 0.35, 1.5, 0.2], dir: [- 0.6, 0.7, - 0.2], twist: - 0.5, lean: - 0.15, ease: 'out' },
                END(0.62)], active: [0.12, 0.3], kind: 'blade', step: [0.04, 3.6, 'back']
        },
        sideLeft: {
            keys: [START,
                { t: 0.1, grip: [- 0.3, 1.35, 0.15], dir: [- 0.55, 0.6, - 0.55], twist: - 0.4 },
                { t: 0.2, grip: [0.15, 1.1, 0.5], dir: [0.8, 0, 0.6], twist: 0.5, ease: 'in' },
                { t: 0.3, grip: [0.35, 0.95, 0.15], dir: [0.85, - 0.3, - 0.4], twist: 0.8, ease: 'out' },
                END(0.6)], active: [0.12, 0.3], kind: 'blade', step: [0.06, 3.2, 'left']
        },
        sideRight: {
            keys: [START,
                { t: 0.1, grip: [0.25, 1.25, 0.25], dir: [0.7, 0.45, - 0.55], twist: 0.6 },
                { t: 0.2, grip: [- 0.15, 1.15, 0.5], dir: [- 0.75, 0.05, 0.65], twist: - 0.3, ease: 'in' },
                { t: 0.3, grip: [- 0.4, 1.05, 0.1], dir: [- 0.85, - 0.2, - 0.45], twist: - 0.8, ease: 'out' },
                END(0.6)], active: [0.12, 0.3], kind: 'blade', step: [0.06, 3.2, 'right']
        },
        spin: {
            keys: [START,
                { t: 0.16, grip: [- 0.42, 1.15, 0.05], dir: [- 0.9, 0.05, - 0.4], twist: - 0.8, lean: 0.05, lower: 0.12 },
                { t: 0.24, grip: [0.28, 1.12, 0.38], dir: [0.86, 0, 0.5], twist: 0.3, lean: 0.12, lower: 0.12, ease: 'in' },
                { t: 0.6, grip: [0.3, 1.1, 0.36], dir: [0.88, - 0.05, 0.46], twist: 0.35, lean: 0.12, lower: 0.12 },
                { t: 0.7, grip: [0.28, 1.0, 0.2], dir: [0.8, - 0.4, - 0.3], twist: 0.6, lean: 0.15, ease: 'out' },
                END(1.0)], active: [0.2, 0.62], kind: 'blade', special: 'spin'
        },
        leap: {
            keys: [START,
                { t: 0.2, grip: [- 0.1, 1.85, 0], dir: [0, 0.35, - 0.94], lean: - 0.25 },
                { t: 0.44, grip: [- 0.05, 1.0, 0.6], dir: [0, - 0.5, 0.86], lean: 0.5, lower: 0.25, ease: 'in' },
                { t: 0.56, grip: [- 0.05, 0.85, 0.5], dir: [0, - 0.75, 0.66], lean: 0.5, lower: 0.3, ease: 'out' },
                END(0.98)], active: [0.38, 0.56], kind: 'blade', step: [0.08, 5.5], special: 'leap'
        },
        uppercut: {
            keys: [START,
                { t: 0.15, grip: [- 0.15, 0.72, 0.36], dir: [- 0.1, - 0.5, 0.86], lean: 0.4, lower: 0.35 },
                { t: 0.3, grip: [- 0.1, 1.45, 0.45], dir: [0, 0.85, 0.5], lean: - 0.1, ease: 'in' },
                { t: 0.42, grip: [- 0.1, 1.75, 0.15], dir: [0, 0.95, - 0.3], lean: - 0.2, ease: 'out' },
                END(0.82)], active: [0.17, 0.4], kind: 'blade', special: 'hop'
        },
        // low on the right, rising across to high on the left
        rising: {
            keys: [START,
                { t: 0.12, grip: [- 0.3, 0.78, 0.25], dir: [- 0.55, - 0.45, 0.7], twist: - 0.5, lean: 0.25, lower: 0.12 },
                { t: 0.21, grip: [0, 1.15, 0.55], dir: [0.35, 0.4, 0.85], twist: 0.1, lean: 0.1, ease: 'in' },
                { t: 0.3, grip: [0.25, 1.52, 0.3], dir: [0.6, 0.7, - 0.1], twist: 0.6, lean: - 0.1, ease: 'out' },
                END(0.62)], active: [0.13, 0.29], kind: 'blade', step: [0.1, 2.6], chain: 0.29
        },
        // level, from the left across to the right (the level cut's return)
        reverse: {
            keys: [START,
                { t: 0.11, grip: [0.3, 1.12, 0.2], dir: [0.8, 0.05, - 0.55], twist: 0.75, lean: 0.05 },
                { t: 0.2, grip: [0, 1.1, 0.55], dir: [- 0.2, 0, 0.98], lean: 0.12, ease: 'in' },
                { t: 0.29, grip: [- 0.4, 1.08, 0.25], dir: [- 0.9, - 0.05, - 0.4], twist: - 0.7, lean: 0.1, ease: 'out' },
                END(0.58)], active: [0.13, 0.29], kind: 'blade', step: [0.1, 2.4], chain: 0.28
        },
        // from over the right shoulder down to the knees
        lowCut: {
            keys: [START,
                { t: 0.12, grip: [- 0.35, 1.35, 0.1], dir: [- 0.5, 0.5, - 0.7], twist: - 0.5 },
                { t: 0.22, grip: [- 0.05, 0.85, 0.55], dir: [0.3, - 0.45, 0.84], lean: 0.35, lower: 0.2, ease: 'in' },
                { t: 0.31, grip: [0.22, 0.74, 0.48], dir: [0.72, - 0.52, 0.46], twist: 0.5, lean: 0.4, lower: 0.22, ease: 'out' },
                END(0.66)], active: [0.15, 0.31], kind: 'blade', step: [0.12, 2.8], chain: 0.31
        }
    },
    // two-handed: wound up behind the right shoulder, brought round the right side and into
    // the trunk at the waist, a little downward, the way a tree is felled; lifted up in front
    // before it goes back on the shoulder (not through the chest)
    axe: {
        chop: {
            keys: [START,
                { t: 0.34, grip: [- 0.3, 1.5, - 0.02], dir: [- 0.32, 0.62, - 0.72], twist: - 0.7, lean: - 0.1 },
                { t: 0.46, grip: [- 0.34, 1.3, 0.2], dir: [- 0.88, 0.3, 0.36], twist: - 0.3, lean: 0.05, ease: 'in' },
                { t: 0.56, grip: [- 0.06, 1.08, 0.46], dir: [0.42, - 0.12, 0.9], twist: 0.15, lean: 0.18, lower: 0.08, ease: 'in' },
                { t: 0.66, grip: [0.16, 0.98, 0.36], dir: [0.85, - 0.22, 0.48], twist: 0.45, lean: 0.2, lower: 0.08, ease: 'out' },
                { t: 0.88, grip: [- 0.06, 1.2, 0.46], dir: [0.15, 0.72, 0.68], twist: 0.1 },
                END(1.16)], active: [0.45, 0.66], kind: 'chop', step: [0.42, 1.2], chain: 0.74
        },
        // high over the right shoulder, down across into the trunk
        diagonal: {
            keys: [START,
                { t: 0.34, grip: [- 0.28, 1.62, 0.05], dir: [- 0.3, 0.75, - 0.58], twist: - 0.6, lean: - 0.12 },
                { t: 0.47, grip: [- 0.25, 1.45, 0.3], dir: [- 0.55, 0.6, 0.58], twist: - 0.3, ease: 'in' },
                { t: 0.56, grip: [- 0.02, 1.05, 0.47], dir: [0.45, - 0.35, 0.82], twist: 0.15, lean: 0.2, lower: 0.1, ease: 'in' },
                { t: 0.66, grip: [0.15, 0.88, 0.34], dir: [0.75, - 0.55, 0.35], twist: 0.45, lean: 0.25, lower: 0.1, ease: 'out' },
                { t: 0.88, grip: [- 0.06, 1.2, 0.46], dir: [0.15, 0.72, 0.68] },
                END(1.16)], active: [0.46, 0.66], kind: 'chop', step: [0.42, 1.2], chain: 0.74
        },
        // from the left, back across into the trunk (the other side of the notch)
        backhand: {
            keys: [START,
                { t: 0.2, grip: [0.02, 1.45, 0.46], dir: [0.3, 0.85, 0.42] },                 // up in front, not across the chest
                { t: 0.38, grip: [0.26, 1.32, 0.3], dir: [0.78, 0.42, - 0.46], twist: 0.65 },
                { t: 0.5, grip: [0.22, 1.2, 0.36], dir: [0.85, 0.2, 0.45], twist: 0.35, ease: 'in' },
                { t: 0.59, grip: [0.0, 1.1, 0.56], dir: [- 0.4, - 0.1, 0.9], twist: - 0.1, lean: 0.12, lower: 0.06, ease: 'in' },
                { t: 0.69, grip: [- 0.2, 1.0, 0.46], dir: [- 0.85, - 0.2, 0.45], twist: - 0.45, lean: 0.14, lower: 0.06, ease: 'out' },
                { t: 0.9, grip: [- 0.06, 1.2, 0.46], dir: [0.15, 0.72, 0.68] },
                END(1.16)], active: [0.49, 0.69], kind: 'chop', step: [0.44, 1.0], chain: 0.76
        },
        // knees bent, low into the foot of the trunk
        low: {
            keys: [START,
                { t: 0.32, grip: [- 0.3, 1.3, 0.05], dir: [- 0.45, 0.55, - 0.7], twist: - 0.6, lean: 0.1, lower: 0.12 },
                { t: 0.45, grip: [- 0.3, 0.9, 0.3], dir: [- 0.85, 0.05, 0.5], twist: - 0.3, lean: 0.35, lower: 0.3, ease: 'in' },
                { t: 0.54, grip: [- 0.04, 0.62, 0.48], dir: [0.45, - 0.2, 0.87], twist: 0.1, lean: 0.45, lower: 0.34, ease: 'in' },
                { t: 0.64, grip: [0.1, 0.64, 0.52], dir: [0.78, - 0.1, 0.62], twist: 0.4, lean: 0.45, lower: 0.34, ease: 'out' },
                { t: 0.88, grip: [- 0.06, 1.15, 0.46], dir: [0.15, 0.72, 0.68] },
                END(1.16)], active: [0.44, 0.64], kind: 'chop', step: [0.4, 1.0], chain: 0.72
        },
        // straight down from over the head, splitting
        overhead: {
            keys: [START,
                { t: 0.38, grip: [- 0.1, 1.75, 0.02], dir: [- 0.05, 0.55, - 0.83], twist: - 0.1, lean: - 0.2 },
                { t: 0.5, grip: [- 0.06, 1.55, 0.35], dir: [0, 0.9, 0.42], ease: 'in' },
                { t: 0.6, grip: [- 0.12, 0.95, 0.64], dir: [0.12, - 0.35, 0.93], lean: 0.32, lower: 0.14, ease: 'in' },
                { t: 0.7, grip: [- 0.14, 0.82, 0.56], dir: [0.14, - 0.6, 0.79], lean: 0.36, lower: 0.16, ease: 'out' },
                { t: 0.92, grip: [- 0.06, 1.2, 0.46], dir: [0.15, 0.72, 0.68] },
                END(1.2)], active: [0.5, 0.7], kind: 'chop', step: [0.46, 1.0], chain: 0.78
        },
        // heavy: the biggest wind-up and the whole body into it (counts twice on a trunk)
        mighty: {
            keys: [START,
                { t: 0.5, grip: [- 0.36, 1.62, - 0.08], dir: [- 0.4, 0.6, - 0.7], twist: - 0.95, lean: - 0.15, lower: 0.05 },
                { t: 0.62, grip: [- 0.4, 1.32, 0.22], dir: [- 0.9, 0.28, 0.33], twist: - 0.45, lean: 0.05, ease: 'in' },
                { t: 0.71, grip: [- 0.06, 1.05, 0.5], dir: [0.42, - 0.15, 0.9], twist: 0.2, lean: 0.22, lower: 0.12, ease: 'in' },
                { t: 0.82, grip: [0.2, 0.94, 0.36], dir: [0.88, - 0.25, 0.42], twist: 0.6, lean: 0.25, lower: 0.12, ease: 'out' },
                { t: 1.06, grip: [- 0.06, 1.2, 0.46], dir: [0.15, 0.72, 0.68] },
                END(1.36)], active: [0.6, 0.82], kind: 'chop', step: [0.58, 1.8]
        }
    },
    // the hoe: raised high and brought over the top into the ground a long step ahead, the
    // handle passing by the right hip, then stood up in front before it goes back on the
    // shoulder; drawn back through the soil; quick short chops; a sweep along the ground
    hoe: {
        dig: {
            keys: [START,
                { t: 0.34, grip: [- 0.12, 1.6, 0.12], dir: [- 0.05, 0.8, - 0.6], twist: - 0.15, lean: - 0.15, edge: [0, 0.6, 0.8] },
                { t: 0.48, grip: [- 0.1, 1.45, 0.3], dir: [0, 0.75, 0.66], lean: 0.05, ease: 'in' },
                { t: 0.64, grip: [- 0.18, 0.8, 0.66], dir: [0.16, - 0.73, 0.66], twist: - 0.1, lean: 0.36, lower: 0.18, ease: 'in' },
                { t: 0.8, grip: [- 0.18, 0.76, 0.56], dir: [0.15, - 0.79, 0.59], twist: - 0.1, lean: 0.4, lower: 0.18, ease: 'out' },
                { t: 1.0, grip: [- 0.1, 1.12, 0.44], dir: [0, 0.72, 0.69] },
                END(1.28)], active: [0.5, 0.8], kind: 'dig', chain: 0.84
        },
        pull: {
            keys: [START,
                { t: 0.3, grip: [- 0.1, 1.1, 0.55], dir: [0, 0.2, 0.98], lean: 0.2 },
                { t: 0.44, grip: [- 0.14, 0.82, 0.74], dir: [0.12, - 0.72, 0.68], lean: 0.42, lower: 0.18, ease: 'in' },
                { t: 0.72, grip: [- 0.18, 0.8, 0.44], dir: [0.15, - 0.84, 0.52], lean: 0.32, lower: 0.18 },
                { t: 0.92, grip: [- 0.1, 1.12, 0.44], dir: [0, 0.72, 0.69] },
                END(1.18)], active: [0.4, 0.72], kind: 'dig', chain: 0.76
        },
        chop: {
            keys: [START,
                { t: 0.22, grip: [- 0.1, 1.3, 0.25], dir: [0, 0.75, 0.66], lean: 0.05 },
                { t: 0.36, grip: [- 0.16, 0.8, 0.64], dir: [0.14, - 0.74, 0.66], lean: 0.38, lower: 0.18, ease: 'in' },
                { t: 0.48, grip: [- 0.16, 0.78, 0.56], dir: [0.15, - 0.8, 0.58], lean: 0.4, lower: 0.18, ease: 'out' },
                { t: 0.66, grip: [- 0.1, 1.12, 0.44], dir: [0, 0.72, 0.69] },
                END(0.9)], active: [0.28, 0.48], kind: 'dig', chain: 0.52
        },
        side: {
            keys: [START,
                { t: 0.28, grip: [- 0.4, 0.78, 0.6], dir: [- 0.58, - 0.6, 0.55], lean: 0.12, lower: 0.26, twist: - 0.45 },
                { t: 0.52, grip: [0.16, 0.76, 0.66], dir: [0.62, - 0.6, 0.5], lean: 0.14, lower: 0.26, twist: 0.4 },
                { t: 0.74, grip: [- 0.1, 1.12, 0.44], dir: [0, 0.72, 0.69] },
                END(1.0)], active: [0.3, 0.52], kind: 'dig', chain: 0.56
        },
        // heavy: the highest lift, driven deepest
        break: {
            keys: [START,
                { t: 0.42, grip: [- 0.12, 1.75, 0.05], dir: [- 0.05, 0.75, - 0.65], twist: - 0.2, lean: - 0.2 },
                { t: 0.56, grip: [- 0.1, 1.55, 0.32], dir: [0, 0.8, 0.6], ease: 'in' },
                { t: 0.7, grip: [- 0.18, 0.74, 0.68], dir: [0.16, - 0.76, 0.63], lean: 0.42, lower: 0.24, ease: 'in' },
                { t: 0.86, grip: [- 0.18, 0.7, 0.58], dir: [0.15, - 0.8, 0.58], lean: 0.44, lower: 0.24, ease: 'out' },
                { t: 1.06, grip: [- 0.1, 1.12, 0.44], dir: [0, 0.72, 0.69] },
                END(1.34)], active: [0.56, 0.86], kind: 'dig'
        }
    },
    // the sickle: bent low, swept through the grass from the right, back from the left, at
    // the roots, a hook pulled toward the body
    sickle: {
        reap: {
            keys: [START,
                { t: 0.15, grip: [- 0.42, 0.62, 0.3], dir: [- 0.55, 0.08, 0.83], twist: - 0.6, lean: 0.5, lower: 0.28 },
                { t: 0.36, grip: [0.36, 0.58, 0.42], dir: [0.62, 0.02, 0.78], twist: 0.55, lean: 0.5, lower: 0.28 },
                END(0.64)], active: [0.15, 0.37], kind: 'reap', chain: 0.4
        },
        back: {
            keys: [START,
                { t: 0.15, grip: [0.3, 0.62, 0.32], dir: [0.55, 0.08, 0.83], twist: 0.6, lean: 0.5, lower: 0.28 },
                { t: 0.36, grip: [- 0.4, 0.6, 0.4], dir: [- 0.62, 0.02, 0.78], twist: - 0.55, lean: 0.5, lower: 0.28 },
                END(0.64)], active: [0.15, 0.37], kind: 'reap', chain: 0.4
        },
        low: {
            keys: [START,
                { t: 0.17, grip: [- 0.45, 0.46, 0.35], dir: [- 0.55, 0, 0.83], twist: - 0.6, lean: 0.6, lower: 0.42 },
                { t: 0.4, grip: [0.34, 0.46, 0.58], dir: [0.55, - 0.02, 0.83], twist: 0.55, lean: 0.6, lower: 0.42 },
                END(0.72)], active: [0.17, 0.41], kind: 'reap', chain: 0.44
        },
        hook: {
            keys: [START,
                { t: 0.17, grip: [- 0.15, 1.25, 0.6], dir: [0.1, 0.6, 0.8], twist: - 0.2, lean: 0.1 },
                { t: 0.35, grip: [- 0.2, 0.85, 0.35], dir: [0.1, 0.2, 0.98], twist: 0.1, lean: 0.3, lower: 0.15, ease: 'in' },
                END(0.64)], active: [0.18, 0.35], kind: 'reap', chain: 0.38
        },
        // heavy: there and back in one breath
        whirl: {
            keys: [START,
                { t: 0.15, grip: [- 0.42, 0.62, 0.3], dir: [- 0.55, 0.08, 0.83], twist: - 0.6, lean: 0.5, lower: 0.3 },
                { t: 0.34, grip: [0.36, 0.58, 0.42], dir: [0.62, 0.02, 0.78], twist: 0.55, lean: 0.5, lower: 0.3 },
                { t: 0.52, grip: [- 0.4, 0.6, 0.4], dir: [- 0.62, 0.02, 0.78], twist: - 0.55, lean: 0.5, lower: 0.3 },
                END(0.84)], active: [0.15, 0.52], kind: 'reap'
        }
    }
}
// each press goes on to the next of these (back to the first after a pause)
const SEQUENCE: Partial<Record<ToolName, string[]>> = {
    sword: ['forehand', 'backhand', 'level', 'thrust', 'rising', 'reverse', 'lowCut', 'overhead'],
    axe: ['chop', 'diagonal', 'backhand', 'low', 'overhead'],
    hoe: ['dig', 'pull', 'chop', 'side'],
    sickle: ['reap', 'back', 'low', 'hook']
}
// Q (or the right button) goes through these
const HEAVY: Partial<Record<ToolName, string[]>> = { sword: ['spin', 'leap', 'uppercut'], axe: ['mighty'], hoe: ['break'], sickle: ['whirl'] }
const MOVE_LABELS: Record<string, string> = {
    forehand: 'Forehand', backhand: 'Backhand', level: 'Level cut', thrust: 'Thrust', rising: 'Rising cut', reverse: 'Return cut',
    lowCut: 'Low cut', overhead: 'Overhead', running: 'Running cut', plunge: 'Plunging cut', sweep: 'Low sweep', retreat: 'Step back and slash',
    sideLeft: 'Side-step cut', sideRight: 'Side-step cut', spin: 'Spin', leap: 'Leaping slam', uppercut: 'Uppercut',
    chop: 'Chop', diagonal: 'Diagonal chop', low: 'Low', mighty: 'Mighty chop',
    dig: 'Dig', pull: 'Draw back', side: 'Sweep', break: 'Break the ground',
    reap: 'Reap', back: 'Reap back', hook: 'Hook', whirl: 'Whirl'
}

// Carried: how each tool is held while walking about (weight: how much the arm gives up its swing)
const CARRY: Record<ToolName, { key: Key, weight: number, pole?: V3 }> = {
    sword: { key: { t: 0, grip: [- 0.25, 0.94, 0.16], dir: [0.06, - 0.55, 0.83], edge: [0, - 0.83, - 0.55] }, weight: 1 },
    sickle: { key: { t: 0, grip: [- 0.24, 0.92, 0.1], dir: [0.02, 0.3, 0.95], edge: [0, - 0.95, 0.3] }, weight: 1 },
    // on the shoulder, the head behind and above it (clear of the arm)
    // (the elbow out to the side, so the upper arm isn't under the handle)
    axe: { key: { t: 0, grip: [- 0.24, 1.2, 0.26], dir: [- 0.05, 0.55, - 0.83], edge: [0, 0.83, 0.55] }, weight: 1, pole: [- 1, - 0.45, 0.1] },
    hoe: { key: { t: 0, grip: [- 0.24, 1.2, 0.26], dir: [- 0.08, 0.52, - 0.85], edge: [0, - 0.85, - 0.52] }, weight: 1, pole: [- 1, - 0.45, 0.1] },
    // a little out to the side and ahead, leaning forward and away from the face
    torch: { key: { t: 0, grip: [- 0.3, 1.1, 0.3], dir: [- 0.14, 0.95, 0.26], edge: [0, - 0.26, 0.95] }, weight: 1, pole: [- 0.8, - 0.8, - 0.2] },
    bow: { key: { t: 0, grip: [0.24, 0.95, 0.12], dir: [0, 1, 0.08], edge: [0, - 0.08, 1] }, weight: 0.35 }
}
// two-handed tools: where the other (left) hand holds the handle, metres along it from the grip
const SECOND_HAND: Partial<Record<ToolName, number>> = { axe: - 0.27, hoe: - 0.34 }
// the working part, for hits (tool space: y along the handle, z the edge)
const BLADE: Record<ToolName, V3[]> = {
    sword: [[0, 0.35, 0], [0, 0.6, 0], [0, 0.84, 0]],
    axe: [[0, 0.42, 0.12], [0, 0.46, 0.06]],
    hoe: [[0, 0.95, 0.17], [0, 0.97, 0.11]],
    sickle: [[0, 0.2, 0.16], [0, 0.3, 0.1], [0, 0.12, 0.17]],
    torch: [[0, 0.44, 0]],
    bow: [[0, 0.7, 0]]
}
const TIP: Record<ToolName, number> = { sword: 0.86, axe: 0.45, hoe: 1.0, sickle: 0.3, torch: 0.45, bow: 0.7 }
// put away, the way people carried them (body-aligned frames of the bone: x left, y up, z
// forward). The Ranger: the sword in its scabbard at the left hip, hilt forward (drawn with
// the right hand), the bow slung on the back, the torch tucked behind the belt; arrows in a
// belt quiver at the right hip. The Villager: the axe hooked in the belt at the right hip,
// head up under its guard; the sickle in its sheath tucked in at the left hip; the hoe slung
// across the back. `hang`: where a belt tool hangs (metres along it): it swings there,
// pushed aside by the legs.
const HOLSTER: Record<ToolName, { bone: 'pelvis' | 'spine_03', position: V3, dir: V3, edge: V3, hang?: number }> = {
    sword: { bone: 'pelvis', position: [0.2, 0.06, 0.15], dir: [0.06, - 0.72, - 0.69], edge: [0, - 0.69, 0.72], hang: 0.12 },
    bow: { bone: 'spine_03', position: [0.02, - 0.02, - 0.3], dir: [- 0.5, 0.86, 0], edge: [0, 0, - 1] },
    torch: { bone: 'pelvis', position: [- 0.05, - 0.02, - 0.18], dir: [- 0.3, 0.9, - 0.3], edge: [0, 0.3, 0.95] },
    axe: { bone: 'pelvis', position: [- 0.24, - 0.33, 0.03], dir: [- 0.05, 1, 0.06], edge: [0, - 0.06, - 1], hang: 0.4 },
    hoe: { bone: 'spine_03', position: [- 0.08, - 0.12, - 0.22], dir: [0.3, 0.95, 0], edge: [0, 0, - 1] },
    sickle: { bone: 'pelvis', position: [0.22, 0.12, 0.06], dir: [0.06, - 0.94, 0.33], edge: [0, 0.33, 0.94], hang: 0 }
}
// how a tool comes out: drawn from a sheath that stays on the belt (the scabbard, the
// sickle's sheath), a guard the other hand takes off (axe, hoe, torch's cap), or nothing on it
const STYLE: Record<ToolName, 'sheath' | 'guard' | 'none'> = { sword: 'sheath', sickle: 'sheath', axe: 'guard', hoe: 'guard', torch: 'guard', bow: 'none' }
// the gear worn: a quiver at the Ranger's right hip and a pouch at the left, the Villager's
// sack hanging at the left hip; and where the other hand puts a guard away (their mouths)
const GEAR: Record<'ranger' | 'peasant', { kind: 'quiver' | 'pouch' | 'sack', bone: 'pelvis', position: V3, dir: V3, edge: V3 }[]> = {
    ranger: [
        { kind: 'quiver', bone: 'pelvis', position: [- 0.21, - 0.05, - 0.1], dir: [- 0.12, 0.93, - 0.34], edge: [- 0.6, 0, 0.8] },
        { kind: 'pouch', bone: 'pelvis', position: [0.17, - 0.06, - 0.13], dir: [0, 1, 0], edge: [0.55, 0, - 0.83] }
    ],
    peasant: [
        { kind: 'sack', bone: 'pelvis', position: [0.2, - 0.12, - 0.15], dir: [0.1, 1, 0], edge: [0.6, 0, - 0.8] }
    ]
}
const STASH: Record<'ranger' | 'peasant', V3> = { ranger: [0.17, 0.04, - 0.13], peasant: [0.21, 0.05, - 0.15] }
const QUIVER_MOUTH: V3 = [- 0.23, 0.24, - 0.17]          // where the arrows' nocks stand (pelvis frame)
// held up in front while the cover comes off or goes on (character space, as the keys)
const PRESENT: Record<ToolName, Key> = {
    sword: { t: 0, grip: [- 0.12, 1.2, 0.34], dir: [0.32, 0.72, 0.62], edge: [0, - 0.65, 0.76] },
    axe: { t: 0, grip: [- 0.1, 1.15, 0.34], dir: [0.4, 0.62, 0.68], edge: [0.2, - 0.75, 0.6] },
    hoe: { t: 0, grip: [- 0.12, 0.8, 0.3], dir: [0.22, 0.95, 0.22], edge: [0, - 0.22, 0.97] },          // upright like a staff, the blade at head height
    sickle: { t: 0, grip: [- 0.1, 1.2, 0.36], dir: [0.3, 0.66, 0.69], edge: [0, - 0.72, 0.69] },
    torch: { t: 0, grip: [- 0.13, 1.15, 0.34], dir: [0.2, 0.95, 0.25], edge: [0, - 0.25, 0.97] },
    bow: { t: 0, grip: [0.14, 1.02, 0.38], dir: [0, 1, 0.1], edge: [0, - 0.1, 1] }       // held up in the left hand
}
// a tool with a guard, taken out (seconds, cumulative): reach for it, pull it out, the other
// hand to the guard, slide it off, put it in the sack or pouch, settle into the carry
const DRAW = { reach: 0.32, pull: 0.8, cover: 1.08, slide: 1.4, stash: 1.78, end: 2.1 }
// putting it away: up in front while the other hand fetches the guard, the guard to the
// tool, slide it on, the tool back where it's worn, let go
const STOW = { present: 0.34, bring: 0.68, slide: 1.0, put: 1.46, end: 1.74 }
// drawn from a sheath: reach for the hilt, draw it out along the sheath, up into the carry;
// put back: the point to the sheath's mouth, slid home, let go
const SHEATHE = { reach: 0.3, out: 0.66, end: 1.05 }
const UNSHEATHE = { mouth: 0.45, in: 0.82, end: 1.06 }
// nothing on it (the bow): reach over the shoulder, bring it round, into the carry
const UNSLING = { reach: 0.34, pull: 0.86, end: 1.16 }
const SLING = { pull: 0.5, end: 0.78 }
// the bow: an arrow taken from the quiver and nocked before every draw
const NOCK = { quiver: 0.22, bow: 0.5, end: 0.58 }
// the body, to keep a held tool out of it: capsules from bone to bone (radius, m); the head
// a capsule up from its bone. The arms holding the tool are left out.
const BODY: { from: string, to: string | null, radius: number }[] = [
    { from: 'pelvis', to: 'spine_03', radius: 0.15 },
    { from: 'spine_03', to: 'neck_01', radius: 0.14 },
    { from: 'Head', to: null, radius: 0.115 },
    { from: 'thigh_l', to: 'calf_l', radius: 0.085 },
    { from: 'thigh_r', to: 'calf_r', radius: 0.085 },
    { from: 'calf_l', to: 'foot_l', radius: 0.065 },
    { from: 'calf_r', to: 'foot_r', radius: 0.065 },
    { from: 'upperarm_l', to: 'lowerarm_l', radius: 0.055 },
    { from: 'lowerarm_l', to: 'hand_l', radius: 0.045 },
    { from: 'upperarm_r', to: 'lowerarm_r', radius: 0.05 }
]
const MAX_ARROWS = 40

// hand space from tool space: the handle runs through the fist toward the thumb (hand +z),
// the edge lines up with the knuckles (hand +y); the same both ways
const HAND_IN_TOOL = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
    new THREE.Vector3(- 1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)))
const UP = new THREE.Vector3(0, 1, 0)

type Pose = { grip: THREE.Vector3, dir: THREE.Vector3, edge: THREE.Vector3, twist: number, lean: number, lower: number }
type Arrow = {
    position: THREE.Vector3, velocity: THREE.Vector3, quaternion: THREE.Quaternion
    stuck: boolean, age: number, stuckAt: number, wobbleAxis: THREE.Vector3, floating: boolean
}
type SwingState = { tool: ToolName, def: Swing, keys: Key[], time: number, hits: Set<unknown>, queued: boolean, recoil: boolean, stepped: boolean, whooshed: boolean, name: string, spinFrom: number, landed: boolean }

const vector = (v: V3) => new THREE.Vector3(v[0], v[1], v[2])
const smooth = (t: number) => t * t * (3 - 2 * t)
const easeIn = (t: number) => t * t
const easeOut = (t: number) => 1 - (1 - t) * (1 - t)

/** A rotation with +Y along `dir` and +Z as close to `edge` as it can be. */
function frame(dir: THREE.Vector3, edge: THREE.Vector3) {
    const y = dir.clone().normalize()
    const z = edge.clone().addScaledVector(y, - edge.dot(y))
    if (z.lengthSq() < 1e-6) z.set(0, 0, 1).addScaledVector(y, - y.z)
    z.normalize()
    const x = new THREE.Vector3().crossVectors(y, z)
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z))
}

/** How many chops fell a tree: 5 for the thinnest trunks, 20 for the thickest. */
export function chopsToFell(plant: Plant) {
    return Math.round(THREE.MathUtils.clamp(5 + (plant.collision - 0.25) / 0.31 * 15, 5, 20))
}

/** A quadratic Bézier from a through (toward) b to c. */
function bezier(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, u: number) {
    const v = 1 - u
    return a.clone().multiplyScalar(v * v).addScaledVector(b, 2 * v * u).addScaledVector(c, u * u)
}

/** Catmull-Rom through four values. */
function spline(a: number, b: number, c: number, d: number, t: number) {
    const t2 = t * t, t3 = t2 * t
    return 0.5 * (2 * b + (- a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (- a + 3 * b - 3 * c + d) * t3)
}

function keyOf(pose: Pose, t: number): Key {
    return { t, grip: pose.grip.toArray() as V3, dir: pose.dir.toArray() as V3, edge: pose.edge.toArray() as V3, twist: pose.twist, lean: pose.lean, lower: pose.lower }
}

function lerpPose(a: Pose, b: Pose, t: number): Pose {
    return {
        grip: a.grip.clone().lerp(b.grip, t),
        dir: a.dir.clone().lerp(b.dir, t).normalize(),
        edge: a.edge.clone().lerp(b.edge, t).normalize(),
        twist: a.twist + (b.twist - a.twist) * t,
        lean: a.lean + (b.lean - a.lean) * t,
        lower: a.lower + (b.lower - a.lower) * t
    }
}

/**
 * The player's tools. Keys 1-3 take one from the body (the same key puts it back), E or a
 * click uses it.
 *
 * Strokes are key poses the hands follow through smooth arcs (Catmull-Rom), accelerating into
 * the hit and slowing through the follow-through, with the chest turning into them and a
 * step forward; the hands turn to hold the tool (the arm solver in CharacterPose) and the
 * edge always leads the motion. Clicking again in time (or holding) chains the next stroke:
 * the sword has three. Hits are tested along the blade actually in the hand while the stroke
 * is live: a trunk or a rock stops it (a brief hit-stop, a camera jolt, chips or sparks, the
 * stroke rebounds), the axe bites and pulls out (enough chops fell the tree), the hoe digs
 * in and turns the soil, the sickle and low cuts mow the grass, bushes get cut down.
 *
 * The bow: holding the button draws (the camera comes in over the shoulder, a crosshair),
 * the string pulled back to the cheek with an arrow nocked; release shoots at the point under
 * the crosshair, aimed up for the drop. Arrows fly with gravity and air drag, stick in the
 * ground and in wood (quivering), glance off rock, splash into water and float.
 *
 * Tools not in hand ride on the body: the sword at the hip, the bow across the back, the
 * axe and hoe slung behind; taking one out reaches for it there.
 */
export default class Tools {
    view: View
    state: State
    settings: Settings
    group = new THREE.Group()
    materials: ToolMaterials
    equipped: ToolName | null = null
    // what the body is asked to do this frame (CharacterPose)
    pose: ToolPose = { right: null, left: null, weight: 0, twist: 0, lean: 0, lower: 0, pitch: 0 }
    aiming = false
    draw = 0                         // bow draw 0..1

    private models = new Map<ToolName, THREE.Group>()
    private inHand = new Set<ToolName>()
    private swing: SwingState | null = null
    private freeze = 0               // hit-stop
    private transition: { tool: ToolName, kind: 'draw' | 'stow', time: number, from: Pose | null, grabbed: boolean, sounded: boolean } | null = null
    private covers = new Map<ToolName, THREE.Group>()
    // where each cover is: on its tool (slid `slide` metres along its way off), in the other
    // hand, or put away in the bag
    private coverState = new Map<ToolName, { at: 'tool' | 'hand' | 'bag' | 'holster', slide: number }>()
    private gear: Record<'ranger' | 'peasant', THREE.Group[]>
    private stored = new Map<ToolName, { position: THREE.Vector3, quaternion: THREE.Quaternion }>()     // where each tool sits on the body this frame
    private hang = new Map<ToolName, THREE.Quaternion>()     // belt tools swung aside by the legs (eased)
    private sequence = new Map<string, number>()     // the next move of each tool's sequence (and its heavies)
    private lastStroke = - 10                         // when the last stroke ended (the sequence starts again after a pause)
    private moveLabel: HTMLElement
    private moveLabelTime = 0
    private notches = new Map<Plant, THREE.Group>()   // the cut in a trunk being felled
    private useHeld = false
    private recover = 0              // after a shot
    private aimLift = 0              // the camera rising to aim level as the draw starts
    private hitMarker = 0
    private streaks: THREE.LineSegments
    private stringTime = 10          // since the string was released
    private raised = 0               // the torch held up
    private torchTilt = 0            // radians forward: the torch lags the arm's swing (a spring)
    private torchTiltSpeed = 0
    private chops = new Map<Plant, number>()
    private spans = new Map<ToolName, [number, number]>()
    private bodyOffset = new THREE.Vector3()          // keeping the held tool out of the body (eased)
    private bodyTurn = new THREE.Quaternion()
    private cuts = new Map<Plant, number>()
    private handWeight = 0
    private last: Pose | null = null
    private held: { right: HandTarget | null, left: HandTarget | null } = { right: null, left: null }
    private hud: HTMLElement
    private crosshair: HTMLElement
    private arrows: Arrow[] = []
    private arrowMesh: THREE.InstancedMesh
    private nocked: THREE.Mesh
    private arrowInHand: THREE.Mesh                   // taken from the quiver, on its way to the string
    private nockTime = - 1                            // since the hand went for an arrow (-1: none on the string, none coming)
    private pendingRelease = false                    // let go before the arrow was on the string: loose it as soon as it is
    private flame: THREE.Group
    private flameLight: THREE.PointLight
    private flicker = 0
    private emberTime = 0
    private trail: Trail
    private climbingAxes: THREE.Group[] = []

    constructor() {
        this.view = View.getInstance()
        this.state = State.getInstance()
        this.settings = Settings.getInstance()
        this.materials = createToolMaterials()
        this.view.scene.add(this.group)

        const arrowGeometry = createArrowGeometry()
        const arrowMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 })
        this.arrowMesh = new THREE.InstancedMesh(arrowGeometry, arrowMaterial, MAX_ARROWS)
        this.arrowMesh.count = 0
        this.arrowMesh.frustumCulled = false
        this.view.scene.add(this.arrowMesh)
        this.nocked = new THREE.Mesh(arrowGeometry, arrowMaterial)
        this.nocked.visible = false
        this.view.scene.add(this.nocked)
        this.arrowInHand = new THREE.Mesh(arrowGeometry, arrowMaterial)
        this.arrowInHand.visible = false
        this.view.scene.add(this.arrowInHand)

        // faint streaks behind arrows in flight, so a shot can be followed
        const streakGeometry = new THREE.BufferGeometry()
        streakGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_ARROWS * 6), 3).setUsage(THREE.DynamicDrawUsage))
        streakGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_ARROWS * 6), 3).setUsage(THREE.DynamicDrawUsage))
        streakGeometry.setDrawRange(0, 0)
        this.streaks = new THREE.LineSegments(streakGeometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
        this.streaks.frustumCulled = false
        this.view.scene.add(this.streaks)
        this.trail = new Trail(this.view.scene)
        this.flame = this.createFlame()
        // always in the scene (dark when the torch is out): a light coming and going would
        // change the light count and recompile every lit material, a visible hitch
        this.flameLight = new THREE.PointLight('#ffa248', 0, 14, 2)
        this.view.scene.add(this.flameLight)
        // compile the nocked arrow's shader now rather than at the first draw of the bow
        this.nocked.visible = true
        this.view.renderer.instance.compile(this.nocked, this.view.camera.instance, this.view.scene)
        this.nocked.visible = false

        const ui = document.querySelector('.ui')!
        this.hud = document.createElement('div')
        this.hud.className = 'hotbar'
        this.hud.setAttribute('role', 'toolbar')
        this.hud.setAttribute('aria-label', 'Tools')
        ui.appendChild(this.hud)
        this.hud.addEventListener('click', (event) => {
            const slot = (event.target as HTMLElement).closest('[data-slot]') as HTMLElement | null
            if (slot) {
                this.select(Number(slot.dataset.slot))
                ;(document.activeElement as HTMLElement | null)?.blur()     // the keys go back to the game
            }
        })
        this.crosshair = document.createElement('div')
        this.crosshair.className = 'crosshair'
        this.crosshair.hidden = true
        this.crosshair.innerHTML = '<span class="crosshair-dot"></span><span class="crosshair-ring"></span><span class="crosshair-hit"></span>'
        ui.appendChild(this.crosshair)
        this.moveLabel = document.createElement('p')
        this.moveLabel.className = 'move-label'
        this.moveLabel.setAttribute('aria-live', 'polite')
        ui.appendChild(this.moveLabel)
        const make = { quiver: createQuiver, pouch: createPouch, sack: createSack }
        this.gear = {
            ranger: GEAR.ranger.map((item) => make[item.kind](this.materials)),
            peasant: GEAR.peasant.map((item) => make[item.kind](this.materials))
        }
        for (const item of [...this.gear.ranger, ...this.gear.peasant])
            this.group.add(item)
        for (const tool of [...SETS.ranger, ...SETS.peasant]) {
            const cover = createCover(tool, this.materials)
            this.covers.set(tool, cover)
            this.group.add(cover)
            this.coverState.set(tool, { at: 'tool', slide: 0 })
        }
        this.resetCovers()
        this.buildModels()
        this.renderHotbar()
        // a pair of climbing axes, in the hands only while climbing a tall face
        for (let i = 0; i < 2; i++) {
            const axe = createClimbingAxe(this.materials)
            axe.visible = false
            this.group.add(axe)
            this.climbingAxes.push(axe)
        }

        const controls = this.state.controls
        for (let i = 0; i < 3; i++)
            controls.events.on(`tool${i + 1}Down`, () => this.select(i))
        controls.events.on('useDown', () => this.useStart())
        controls.events.on('heavyDown', () => this.heavy())
        controls.events.on('useUp', () => this.useEnd())
        // the mouse: with pointer lock a button press uses the tool; without, a press that
        // doesn't turn into a drag (dragging orbits the camera); the bow draws while held
        const canvas = this.view.renderer.instance.domElement
        let downAt = 0, moved = 0, pressing = false
        // the right button: the heavy attack (and no context menu over the game)
        canvas.addEventListener('contextmenu', (event) => event.preventDefault())
        canvas.addEventListener('pointerdown', (event) => {
            if (event.button === 2) {
                this.heavy()
                return
            }
            if (event.button !== 0) return
            downAt = performance.now()
            moved = 0
            pressing = true
            if (document.pointerLockElement || this.equipped === 'bow') this.useStart()
        })
        canvas.addEventListener('pointermove', (event) => { if (pressing) moved += Math.abs(event.movementX) + Math.abs(event.movementY) })
        window.addEventListener('pointerup', (event) => {
            if (event.button !== 0 || !pressing) return
            pressing = false
            if (document.pointerLockElement || this.equipped === 'bow') this.useEnd()
            else if (moved < 14 && performance.now() - downAt < 650) {      // a click, even an unhurried one; a real drag turns the camera
                this.useStart()
                this.useEnd()
            }
        })
        this.settings.events.on('change:character', () => {
            this.equipped = null
            this.inHand.clear()
            this.swing = null
            this.transition = null
            this.resetCovers()
            this.aiming = false
            this.buildModels()
            this.renderHotbar()
        })
    }

    get set() {
        return SETS[this.kind]
    }

    private get kind(): 'ranger' | 'peasant' {
        return this.settings.get('character').includes('peasant') ? 'peasant' : 'ranger'
    }

    private buildModels() {
        for (const model of this.models.values())
            model.visible = false
        for (const tool of this.set) {
            let model = this.models.get(tool)
            if (!model) {
                model = createTool(tool, this.materials)
                this.models.set(tool, model)
                this.group.add(model)
            }
            model.visible = true
            if (tool === 'torch')
                model.add(this.flame)
        }
        for (const [tool, cover] of this.covers)
            cover.visible = this.set.includes(tool) && STYLE[tool] !== 'none'
        for (const item of this.gear.ranger) item.visible = this.kind === 'ranger'
        for (const item of this.gear.peasant) item.visible = this.kind === 'peasant'
    }

    private renderHotbar() {
        const slots = this.set.map((tool, i) => {
            const active = this.equipped === tool
            return `<button class="slot${active ? ' is-active' : ''}" data-slot="${i}" aria-pressed="${active}" title="${TOOL_LABELS[tool]} (${i + 1})">`
                + `<svg viewBox="0 0 24 24" aria-hidden="true">${TOOL_ICONS[tool]}</svg>`
                + `<kbd>${i + 1}</kbd><span class="slot-name">${TOOL_LABELS[tool]}</span></button>`
        }).join('')
        const hint = this.equipped
            ? `<p class="hotbar-hint"><kbd>E</kbd><span class="or">or click</span><span class="action">${ACTIONS[this.equipped]}</span></p>`
            : ''
        this.hud.innerHTML = `<div class="hotbar-slots">${slots}</div>${hint}`
    }

    /**
     * Take out the tool in this slot (the same slot again puts it away). Putting one away and
     * taking another out are actions the body goes through step by step (updateTransition);
     * a choice made meanwhile is taken up when the current one is done.
     */
    select(slot: number | null) {
        const player = this.state.player
        if (player.swimming || player.climbing || player.mantle)
            return
        const tool = slot === null ? null : this.set[slot]
        this.equipped = tool === this.equipped ? null : tool
        this.swing = null
        this.aiming = false
        this.draw = 0
        if (!this.transition)
            this.advance()
        this.renderHotbar()
    }

    /** Every tool put away as it's worn: its guard on it, its sheath on the belt. */
    private resetCovers() {
        for (const [tool, state] of this.coverState) {
            state.at = STYLE[tool] === 'sheath' ? 'holster' : 'tool'
            state.slide = 0
        }
    }

    /** The next action toward the chosen tool: put away the one in hand, or take out the chosen one. */
    private advance() {
        const held = [...this.inHand][0] ?? null
        if (held && held !== this.equipped)
            this.transition = { tool: held, kind: 'stow', time: 0, from: this.last, grabbed: true, sounded: false }
        else if (!held && this.equipped)
            this.transition = { tool: this.equipped, kind: 'draw', time: 0, from: null, grabbed: false, sounded: false }
        else
            this.transition = null
    }

    private useStart() {
        this.useHeld = true
        const tool = this.equipped
        const player = this.state.player
        if (!tool || player.swimming || player.climbing || player.mantle || this.transition || !this.inHand.has(tool))
            return
        if (tool === 'bow') {
            if (!this.aiming)
                this.aimLift = 0.3        // raise a downward-looking camera to the horizon
            this.aiming = true
            this.pendingRelease = false
            if (this.nockTime < 0)
                this.nockTime = 0         // an arrow from the quiver first
            return
        }
        if (!SWINGS[tool])
            return
        if (!this.swing)
            this.startSwing(tool, this.lightStroke(tool))
        else if (!this.swing.recoil)
            this.swing.queued = true
    }

    /**
     * Which stroke a press starts: with the sword, what the body is doing picks some (in the
     * air, sprinting, crouched, backing away, side-stepping); otherwise each press goes on to
     * the next move of the tool's sequence, back to the first after a pause.
     */
    private lightStroke(tool: ToolName) {
        if (tool === 'sword') {
            const player = this.state.player
            const keys = this.state.controls.keys.down
            if (!player.grounded) return 'plunge'
            if (player.speed > player.walkSpeed + 1) return 'running'
            if (keys.crouch) return 'sweep'
            if (keys.backward && !keys.forward) return 'retreat'
            if (keys.strafeLeft && !keys.strafeRight && !keys.forward) return 'sideLeft'
            if (keys.strafeRight && !keys.strafeLeft && !keys.forward) return 'sideRight'
        }
        return this.nextOf(tool, SEQUENCE[tool]!, 'light')
    }

    /** The next move of a list (each list keeps its place; a pause starts it again). */
    private nextOf(tool: ToolName, list: string[], kind: string) {
        const key = `${tool}:${kind}`
        const elapsed = this.state.time.elapsed
        let index = this.sequence.get(key) ?? 0
        if (elapsed - this.lastStroke > 2.5 && !this.swing)
            index = 0
        this.sequence.set(key, index + 1)
        return list[index % list.length]
    }

    /** The heavy attack (Q or the right button): each tool's own; the sword goes through three. */
    heavy() {
        const tool = this.equipped
        const player = this.state.player
        if (!tool || !HEAVY[tool] || !this.inHand.has(tool) || player.swimming || player.climbing || player.mantle || this.transition)
            return
        if (this.swing && !(this.swing.def.chain !== undefined && this.swing.time >= this.swing.def.chain))
            return
        const keys = this.state.controls.keys.down
        const name = tool === 'sword' && keys.crouch ? 'uppercut' : tool === 'sword' && keys.forward && player.grounded ? 'leap' : this.nextOf(tool, HEAVY[tool]!, 'heavy')
        this.startSwing(tool, name)
    }

    private useEnd() {
        this.useHeld = false
        if (this.equipped === 'bow' && this.aiming) {
            // let go: loose the arrow (a tap still looses a quick, weak one, once it's on the string)
            if (this.nockTime >= NOCK.end) {
                this.draw = Math.max(this.draw, 0.3)
                this.shoot()
                this.aiming = false
            }
            else
                this.pendingRelease = true
        }
    }

    // ── strokes ──

    private startSwing(tool: ToolName, name: string) {
        const def = SWINGS[tool]![name]
        const keys = def.keys.map((key) => ({ ...key }))
        // from wherever the hands are now, back to the carry at the end
        const from = this.last ?? this.carryPose(tool)
        keys[0] = keyOf(from, 0)
        keys[keys.length - 1] = { ...keyOf(this.carryPose(tool), keys[keys.length - 1].t), ease: 'inout' }
        this.swing = { tool, def, keys, time: 0, hits: new Set(), queued: false, recoil: false, stepped: false, whooshed: false, name, spinFrom: this.state.player.rotation, landed: false }
        this.trail.clear()
        // the move's name by the toolbar, and where it is in the tool's sequence
        const list = SEQUENCE[tool] ?? []
        const heavy = HEAVY[tool]?.includes(name)
        const place = list.indexOf(name)
        this.showLabel(heavy ? `Heavy · ${MOVE_LABELS[name] ?? name}` : place >= 0 ? `${MOVE_LABELS[name] ?? name}<span>${place + 1} / ${list.length}</span>` : MOVE_LABELS[name] ?? name)
        const player = this.state.player
        if (def.special === 'plunge')
            player.velocity[1] = Math.min(player.velocity[1], - 7)       // dropping onto the cut
        if (def.special === 'leap' && player.grounded) {
            player.velocity[1] = 6.5
            player.grounded = false
        }
    }

    /** After hitting something solid: hold for a beat (the blade bites), then back to the carry. */
    private rebound(hold: number, recover: number) {
        if (!this.swing || !this.last)
            return
        const tool = this.swing.tool
        const at = { ...this.last, grip: this.last.grip.clone().addScaledVector(this.last.dir, - 0.05) }
        const keys: Key[] = [keyOf(at, 0), keyOf(at, hold), { ...keyOf(this.carryPose(tool), hold + recover), ease: 'inout' }]
        this.swing = { ...this.swing, keys, time: 0, recoil: true, queued: false, def: { ...this.swing.def, active: [- 1, - 1], step: undefined, chain: undefined } }
    }

    /** The stroke's pose at time t (before the edge is worked out). */
    private sampleKeys(keys: Key[], time: number) {
        let i = keys.length - 2
        for (let k = 0; k < keys.length - 1; k++)
            if (time < keys[k + 1].t) { i = k; break }
        const a = keys[Math.max(0, i - 1)], b = keys[i], c = keys[i + 1], d = keys[Math.min(keys.length - 1, i + 2)]
        let u = THREE.MathUtils.clamp((time - b.t) / Math.max(1e-4, c.t - b.t), 0, 1)
        u = c.ease === 'in' ? easeIn(u) : c.ease === 'out' ? easeOut(u) : smooth(u)
        const s3 = (pick: (key: Key) => V3) => new THREE.Vector3(
            spline(pick(a)[0], pick(b)[0], pick(c)[0], pick(d)[0], u),
            spline(pick(a)[1], pick(b)[1], pick(c)[1], pick(d)[1], u),
            spline(pick(a)[2], pick(b)[2], pick(c)[2], pick(d)[2], u))
        const s1 = (pick: (key: Key) => number) => spline(pick(a), pick(b), pick(c), pick(d), u)
        const grip = s3((key) => key.grip)
        // the direction: a spline through the keys where they're close, but along the arc
        // between them where they turn far (a spline of nearly opposite directions passes
        // close to zero, and the tool would flip through the body in a frame)
        const from = vector(b.dir).normalize(), to = vector(c.dir).normalize()
        const angle = from.angleTo(to)
        const along = arcBetween(from, to, u)
        const curve = s3((key) => vector(key.dir).normalize().toArray() as V3)
        const dir = curve.lengthSq() > 1e-6 ? curve.normalize().lerp(along, THREE.MathUtils.smoothstep(angle, 0.7, 1.3)).normalize() : along
        const hintOf = (key: Key) => key.edge ?? [0, - 0.6, 0.8] as V3
        const edge = vector(hintOf(b)).lerp(vector(hintOf(c)), u)
        return { grip, dir, edge, twist: s1((key) => key.twist ?? 0), lean: s1((key) => key.lean ?? 0), lower: Math.max(0, s1((key) => key.lower ?? 0)) }
    }

    /** The pose with the edge leading the motion (the hint holds while the tool barely moves). */
    private strokePose(tool: ToolName, keys: Key[], time: number): Pose {
        const pose = this.sampleKeys(keys, time)
        const next = this.sampleKeys(keys, time + 0.012)
        const length = TIP[tool]
        const motion = next.grip.addScaledVector(next.dir, length).sub(pose.grip.clone().addScaledVector(pose.dir, length)).divideScalar(0.012)
        motion.addScaledVector(pose.dir, - motion.dot(pose.dir))
        const speed = motion.length()
        const edge = pose.edge.clone().addScaledVector(pose.dir, - pose.edge.dot(pose.dir)).normalize()
        if (speed > 1e-4)
            edge.lerp(motion.divideScalar(speed), THREE.MathUtils.smoothstep(speed, 0.8, 3))
        pose.edge = edge.normalize()
        return pose
    }

    private carryPose(tool: ToolName): Pose {
        const key = CARRY[tool].key
        return { grip: vector(key.grip), dir: vector(key.dir).normalize(), edge: vector(key.edge!), twist: 0, lean: 0, lower: 0 }
    }

    // ── the character's space ──

    private get facing() {
        // the character's yaw: its group's (the State's rotation) plus the model's own turn
        return this.state.player.rotation + this.view.player.modelYaw
    }

    /** A world point into the character's space (the model's frame). */
    private toLocal(world: THREE.Vector3) {
        const model = this.view.player.model
        return model ? model.worldToLocal(world.clone()) : world.clone()
    }

    private ground(x: number, z: number) {
        return this.state.player.groundAt(x, z)
    }

    /** How far a tool reaches along its handle, below and above the grip (from its model). */
    private span(tool: ToolName): [number, number] {
        let span = this.spans.get(tool)
        if (!span) {
            const model = this.models.get(tool)!
            const box = new THREE.Box3()
            model.updateMatrixWorld(true)
            const toModel = new THREE.Matrix4()
            model.traverse((child) => {
                const mesh = child as THREE.Mesh
                if (!mesh.isMesh) return
                mesh.geometry.computeBoundingBox()
                toModel.copy(model.matrixWorld).invert().multiply(mesh.matrixWorld)
                box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(toModel))
            })
            span = [box.min.y, box.max.y]
            this.spans.set(tool, span)
        }
        return span
    }

    /**
     * Keep a held tool out of the body: the handle and head are tested against capsules
     * around the trunk, head, legs and the free arm (as posed last frame); where they would
     * pass through, the tool is turned about the hand (and near the hand, the hand moved)
     * just clear of it. The correction eases in and out so a fast stroke doesn't pop.
     */
    private keepOffBody(tool: ToolName, pose: Pose) {
        const player = this.view.player
        const model = player.model
        if (!model)
            return
        const shift = player.chestShift
        const second = SECOND_HAND[tool]
        const capsules: [THREE.Vector3, THREE.Vector3, number][] = []
        const position = (name: string) => {
            const bone = player.bone(name)
            return bone ? this.toLocal(bone.getWorldPosition(new THREE.Vector3())) : null
        }
        for (const part of BODY) {
            if (second !== undefined && part.from === 'lowerarm_l')
                continue        // the other hand is on the handle too
            const a = position(part.from)
            const b = part.to ? position(part.to) : a && a.clone().add(new THREE.Vector3(0, 0.14, 0.02))
            if (a && b)
                capsules.push([a, b, part.radius])
        }
        const [low, high] = this.span(tool)
        const grip = pose.grip.clone().add(shift)
        const dir = pose.dir.clone()
        const point = new THREE.Vector3(), closest = new THREE.Vector3(), segment = new THREE.Vector3()
        for (let pass = 0; pass < 3; pass++) {
            let depth = 0, at = 0
            const normal = new THREE.Vector3()
            for (let s = low; s <= high; s += 0.035) {
                if (Math.abs(s) < 0.1 || (second !== undefined && Math.abs(s - second) < 0.1))
                    continue        // in the hands
                point.copy(grip).addScaledVector(dir, s)
                for (const [a, b, radius] of capsules) {
                    segment.subVectors(b, a)
                    const t = THREE.MathUtils.clamp(point.clone().sub(a).dot(segment) / Math.max(1e-6, segment.lengthSq()), 0, 1)
                    closest.copy(a).addScaledVector(segment, t)
                    const distance = point.distanceTo(closest)
                    const d = radius + 0.015 - distance
                    if (d > depth && distance > 1e-5) {
                        depth = d
                        at = s
                        normal.subVectors(point, closest).divideScalar(distance)
                    }
                }
            }
            if (depth <= 0)
                break
            // close to the hand the hand gives way, further along the tool turns
            const move = THREE.MathUtils.clamp(1 - (Math.abs(at) - 0.1) / 0.3, 0, 1) * 0.6
            grip.addScaledVector(normal, depth * move)
            dir.addScaledVector(normal, depth * (1 - move) / at).normalize()
        }
        // eased: quickly in, slower out
        const dt = Math.min(this.state.time.delta, 0.05)
        const offset = grip.sub(shift).sub(pose.grip)
        const turn = new THREE.Quaternion().setFromUnitVectors(pose.dir, dir)
        const rate = offset.lengthSq() > this.bodyOffset.lengthSq() || turn.w < this.bodyTurn.w ? 40 : 12
        const k = 1 - Math.exp(- dt * rate)
        this.bodyOffset.lerp(offset, k)
        this.bodyTurn.slerp(turn, k)
        pose.grip.add(this.bodyOffset)
        pose.dir.applyQuaternion(this.bodyTurn).normalize()
        pose.edge.applyQuaternion(this.bodyTurn)
    }

    /** The body's targets for holding a tool in this pose (character space). */
    private holdPose(tool: ToolName, pose: Pose, weight: number, pole?: V3) {
        if (tool !== 'bow' && !this.transition)
            this.keepOffBody(tool, pose)
        else {
            this.bodyOffset.set(0, 0, 0)
            this.bodyTurn.identity()
        }
        const hand = frame(pose.dir, pose.edge).multiply(HAND_IN_TOOL)
        const main = { position: pose.grip.clone(), quaternion: hand, pole: pole ? vector(pole) : undefined }
        const second = SECOND_HAND[tool]
        const other = second !== undefined ? { position: pose.grip.clone().addScaledVector(pose.dir, second), quaternion: hand.clone() } : null
        this.pose = tool === 'bow'
            ? { right: null, left: main, weight, twist: pose.twist, lean: pose.lean, lower: pose.lower, pitch: 0 }
            : { right: main, left: other, weight, twist: pose.twist, lean: pose.lean, lower: pose.lower, pitch: 0 }
    }

    /** A tool on the body, in the world (from its bone, as last posed). */
    private holsterWorld(tool: ToolName) {
        return this.stored.get(tool) ?? this.restingWorld(tool)
    }

    /** Where a tool is worn (in the world), before a belt tool swings aside from the legs. */
    private restingWorld(tool: ToolName) {
        const holster = HOLSTER[tool]
        const bone = this.view.player.boneFrame(holster.bone)
        if (!bone)
            return null
        const position = vector(holster.position).applyQuaternion(bone.quaternion).add(bone.position)
        const quaternion = bone.quaternion.multiply(frame(vector(holster.dir), vector(holster.edge)))
        return { position, quaternion }
    }

    /** Each tool's place on the body this frame (belt tools swung clear of the legs). */
    private updateStored() {
        for (const tool of this.set) {
            const rest = this.restingWorld(tool)
            if (!rest)
                continue
            const hang = HOLSTER[tool].hang
            if (hang !== undefined)
                this.hangClear(tool, rest, hang)
            this.stored.set(tool, rest)
        }
    }

    /**
     * A tool hanging from the belt swings there: turned about where it hangs just clear of
     * the legs (the thigh pushes it aside as it comes forward), easing back as the leg goes
     * by, instead of the stride passing through it. Changes `pose` (world).
     */
    private hangClear(tool: ToolName, pose: { position: THREE.Vector3, quaternion: THREE.Quaternion }, hang: number) {
        const player = this.view.player
        const legs: [THREE.Vector3, THREE.Vector3, number][] = []
        for (const [from, to, radius] of [['thigh_l', 'calf_l', 0.095], ['calf_l', 'foot_l', 0.075], ['thigh_r', 'calf_r', 0.095], ['calf_r', 'foot_r', 0.075]] as const) {
            const a = player.bone(from), b = player.bone(to)
            if (a && b)
                legs.push([a.getWorldPosition(new THREE.Vector3()), b.getWorldPosition(new THREE.Vector3()), radius])
        }
        const [low, high] = this.span(tool)
        const rest = new THREE.Vector3(0, 1, 0).applyQuaternion(pose.quaternion)
        const pivot = pose.position.clone().addScaledVector(rest, hang)
        const dir = rest.clone()
        const point = new THREE.Vector3(), closest = new THREE.Vector3(), segment = new THREE.Vector3()
        for (let pass = 0; pass < 3; pass++) {
            let depth = 0, at = 0
            const normal = new THREE.Vector3()
            for (let s = low; s <= high; s += 0.04) {
                const along = s - hang
                if (Math.abs(along) < 0.08)
                    continue        // where it hangs
                point.copy(pivot).addScaledVector(dir, along)
                for (const [a, b, radius] of legs) {
                    segment.subVectors(b, a)
                    const t = THREE.MathUtils.clamp(point.clone().sub(a).dot(segment) / Math.max(1e-6, segment.lengthSq()), 0, 1)
                    closest.copy(a).addScaledVector(segment, t)
                    const distance = point.distanceTo(closest)
                    const d = radius + 0.015 - distance
                    if (d > depth && distance > 1e-5) {
                        depth = d
                        at = along
                        normal.subVectors(point, closest).divideScalar(distance)
                    }
                }
            }
            if (depth <= 0)
                break
            dir.addScaledVector(normal, depth / at).normalize()
        }
        // pushed aside at once, swinging back more slowly
        const dt = Math.min(this.state.time.delta, 0.05)
        const turn = new THREE.Quaternion().setFromUnitVectors(rest, dir)
        let eased = this.hang.get(tool)
        if (!eased) {
            eased = new THREE.Quaternion()
            this.hang.set(tool, eased)
        }
        eased.slerp(turn, 1 - Math.exp(- dt * (turn.w < eased.w ? 45 : 7)))
        pose.quaternion.premultiply(eased)
        pose.position.sub(pivot).applyQuaternion(eased).add(pivot)
    }

    /** A tool on the body, as a pose of the hand reaching for its grip (character space). */
    private holsterPose(tool: ToolName): Pose | null {
        const holster = this.holsterWorld(tool)
        const model = this.view.player.model
        if (!holster || !model)
            return null
        const inverse = model.getWorldQuaternion(new THREE.Quaternion()).invert()
        const quaternion = inverse.multiply(holster.quaternion)
        return {
            grip: this.toLocal(holster.position).sub(this.view.player.chestShift),
            dir: new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion),
            edge: new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion),
            twist: 0, lean: 0, lower: 0
        }
    }

    // ── world effects ──

    private jolt(amount: number) {
        this.state.player.camera.thirdPerson.shake(amount)
    }

    /** Tests the live stroke against the world, after the tool is placed in the hand. */
    private testHits() {
        const swing = this.swing
        if (!swing || swing.recoil || this.freeze > 0)
            return
        const def = swing.def
        const tool = swing.tool
        const model = this.models.get(tool)!
        model.updateMatrixWorld(true)
        const base = new THREE.Vector3(0, 0.3, 0).applyMatrix4(model.matrixWorld)
        const tip = new THREE.Vector3(0, TIP[tool], 0).applyMatrix4(model.matrixWorld)
        if (tool === 'sword' && swing.time >= def.active[0] - 0.03 && swing.time <= def.active[1] + 0.05)
            this.trail.push(base, tip)
        if (swing.time < def.active[0] || swing.time > def.active[1])
            return
        const particles = this.view.particles
        const p = this.state.player.position.current
        const away = new THREE.Vector3(tip.x - p[0], 0, tip.z - p[2]).normalize()

        for (const point of BLADE[tool].map((v) => vector(v).applyMatrix4(model.matrixWorld))) {
            if (!swing.hits.has('animal') && this.view.wildlife.hit(point, new THREE.Vector3(p[0], p[1], p[2]))) {
                swing.hits.add('animal')
                this.freeze = 0.07
                this.jolt(0.2)
                this.rebound(0.05, 0.38)
                return
            }
            // trunks and boulders stop the blade
            const plant = this.state.vegetation.solidAt(point.x, point.y, point.z, 0.03)
            if (plant && !swing.hits.has(plant)) {
                swing.hits.add(plant)
                const normal = new THREE.Vector3(point.x - plant.x, 0.3, point.z - plant.z).normalize()
                if (plant.kind === PLANT.ROCK) {
                    this.view.audio.play('hitRock', point)
                    particles.emit('spark', point, 14, normal, 5, 0.7)
                    particles.emit('dust', point, 2, normal, 0.6, 0.8)
                    this.freeze = 0.09
                    this.jolt(0.32)
                    this.rebound(0.06, 0.4)
                    return
                }
                this.view.audio.play('hitWood', point, tool === 'axe' ? 1 : 0.6)
                particles.emit('chip', point, tool === 'axe' ? 12 : 6, normal, tool === 'axe' ? 3.2 : 2.2, 0.65)
                this.view.trees.strike(plant.x, plant.z, plant.x - p[0], plant.z - p[2], tool === 'axe' ? 1 : 0.45)
                if (tool === 'axe') {
                    // the cut deepens with every chop; a thin trunk falls after 5 to 10, a
                    // thick one takes up to 20 (the heavy chop counts twice)
                    this.freeze = 0.1
                    this.jolt(0.34)
                    const needed = chopsToFell(plant)
                    const chops = (this.chops.get(plant) ?? 0) + (swing.name === 'mighty' ? 2 : 1)
                    this.chops.set(plant, chops)
                    this.notch(plant, point, Math.min(1, chops / needed))
                    this.showLabel(`${MOVE_LABELS[swing.name] ?? 'Chop'}<span>${Math.min(chops, needed)} / ${needed}</span>`)
                    particles.emit('chip', point, 8, normal, 2.6, 0.7)
                    if (chops >= needed) {
                        this.chops.delete(plant)
                        this.removeNotch(plant)
                        this.view.trees.fell(plant, plant.x - p[0], plant.z - p[2])
                        particles.emit('leaf', new THREE.Vector3(plant.x, plant.y + plant.scale * 0.7, plant.z), 18, UP, 2.5, 0.9)
                    }
                    this.rebound(0.16, 0.42)
                }
                else {
                    // the hoe and the blades nick the bark
                    if (tool === 'hoe' && !this.notches.has(plant))
                        this.notch(plant, point, 0.06)
                    this.freeze = 0.07
                    this.jolt(0.2)
                    this.rebound(0.05, 0.38)
                }
                return
            }

            const ground = this.ground(point.x, point.z)
            // the hoe digs in; any other blade striking the ground stops
            if (point.y < ground + (def.kind === 'dig' ? 0.04 : - 0.02)) {
                if (ground < WATER_LEVEL) {
                    this.view.audio.play('splash', point, 0.6)
                    particles.emit('splash', new THREE.Vector3(point.x, WATER_LEVEL, point.z), 10, UP, 2.6, 0.5)
                    this.rebound(0.05, 0.4)
                    return
                }
                const at = new THREE.Vector3(point.x, ground + 0.03, point.z)
                this.view.audio.play(def.kind === 'dig' ? 'dig' : 'hitWood', at, def.kind === 'dig' ? 1 : 0.4)
                particles.emit('dirt', at, def.kind === 'dig' ? 16 : 7, away.clone().negate().setY(1.2), 2.6, 0.55)
                particles.emit('dust', at, 2, UP, 0.5, 0.8)
                if (def.kind === 'dig') {
                    this.view.groundWetness.till(at.x, at.z, 0.42, 0.3, this.facing + Math.PI / 2)
                    this.view.grass.trail.cut(at.x, at.z, 0.6, 1)
                    this.jolt(0.14)
                    this.freeze = 0.05
                    this.rebound(0.14, 0.42)
                }
                else {
                    // an axe (or a blade) driven into the ground leaves a cut in it
                    if (tool === 'axe')
                        this.view.groundWetness.till(at.x, at.z, 0.22, 0.12, this.facing + Math.PI / 2)
                    this.jolt(0.18)
                    this.freeze = 0.06
                    this.rebound(0.05, 0.4)
                }
                return
            }
            if (point.y < WATER_LEVEL && !swing.hits.has('water')) {
                swing.hits.add('water')
                particles.emit('splash', new THREE.Vector3(point.x, WATER_LEVEL, point.z), 8, UP, 2.2, 0.5)
            }

            // bushes: shaken and, after a few cuts, cut down
            if (def.kind !== 'dig') {
                const bush = this.state.vegetation.nearest(point.x, point.z, 1.6, [PLANT.BUSH])
                if (bush && !swing.hits.has(bush) && Math.hypot(point.x - bush.x, point.z - bush.z) < bush.scale * 0.55 && point.y < bush.y + bush.scale * 1.1) {
                    swing.hits.add(bush)
                    this.view.trees.strike(bush.x, bush.z, bush.x - p[0], bush.z - p[2], 1.2)
                    this.view.audio.play('reap', point, 1.4)
                    particles.emit('leaf', point, 8, UP, 2.2, 0.9)
                    const cuts = (this.cuts.get(bush) ?? 0) + 1
                    this.cuts.set(bush, cuts)
                    if (cuts >= 3) {
                        this.cuts.delete(bush)
                        particles.emit('leaf', new THREE.Vector3(bush.x, bush.y + bush.scale * 0.5, bush.z), 26, UP, 3, 1)
                        this.state.vegetation.remove(bush)
                    }
                }
            }
        }

        // low cuts mow the grass along the arc
        const low = tip.y - this.ground(tip.x, tip.z)
        if ((def.kind === 'reap' || def.kind === 'blade') && low < 0.75 && low > - 0.1 && tip.y > WATER_LEVEL) {
            this.view.grass.trail.cut(tip.x, tip.z, def.kind === 'reap' ? 0.7 : 0.5, def.kind === 'reap' ? 1 : 0.85)
            if (!swing.hits.has('grass')) {
                swing.hits.add('grass')
                this.view.audio.play('reap', tip)
            }
            if (Math.random() < (def.kind === 'reap' ? 0.9 : 0.5))
                particles.emit('grass', tip, def.kind === 'reap' ? 5 : 3, away.clone().setY(0.8), 2.2, 0.8)
        }
    }

    // ── the bow ──

    /** Where the crosshair points: the first ground or solid along the camera's view, or far away. */
    private aimPoint() {
        const camera = this.view.camera.instance
        const origin = camera.getWorldPosition(new THREE.Vector3())
        const direction = camera.getWorldDirection(new THREE.Vector3())
        const blocked = (q: THREE.Vector3) => q.y < this.ground(q.x, q.z) || this.state.vegetation.isSolid(q.x, q.y, q.z, 0)
        let distance = 1.5
        while (distance < 320) {
            if (blocked(origin.clone().addScaledVector(direction, distance))) {
                // narrow it down between the last two samples
                let lo = distance - (distance < 40 ? 0.5 : 2), hi = distance
                for (let i = 0; i < 6; i++) {
                    const mid = (lo + hi) / 2
                    if (blocked(origin.clone().addScaledVector(direction, mid))) hi = mid
                    else lo = mid
                }
                return origin.addScaledVector(direction, hi)
            }
            distance += distance < 40 ? 0.5 : 2
        }
        return origin.addScaledVector(direction, 320)
    }

    /** The aim's direction in the character's space (the bow arm follows it). */
    private aimLocal() {
        const direction = this.view.camera.instance.getWorldDirection(new THREE.Vector3())
        return direction.applyAxisAngle(UP, - this.facing).normalize()
    }

    private shoot() {
        const model = this.models.get('bow')!
        const start = this.nocked.visible ? this.nocked.position.clone() : new THREE.Vector3().setFromMatrixPosition(model.matrixWorld)
        const target = this.aimPoint()
        const speed = 24 + 38 * this.draw
        // the launch angle that drops onto the target (the flatter of the two)
        const dx = target.x - start.x, dz = target.z - start.z
        const d = Math.hypot(dx, dz), h = target.y - start.y, g = 9.81
        const disc = speed ** 4 - g * (g * d * d + 2 * h * speed * speed)
        const angle = disc >= 0 && d > 0.5 ? Math.atan((speed * speed - Math.sqrt(disc)) / (g * d)) : Math.atan2(h, Math.max(d, 1e-3)) + 0.05
        const horizontal = Math.max(d, 1e-4)
        const direction = new THREE.Vector3(dx / horizontal * Math.cos(angle), Math.sin(angle), dz / horizontal * Math.cos(angle))
        const player = this.state.player
        this.arrows.push({
            position: start,
            velocity: direction.multiplyScalar(speed).add(new THREE.Vector3(player.velocity[0], 0, player.velocity[2])),
            quaternion: new THREE.Quaternion().setFromUnitVectors(UP, direction.clone().normalize()),
            stuck: false, age: 0, stuckAt: 0, wobbleAxis: new THREE.Vector3(1, 0, 0), floating: false
        })
        if (this.arrows.length > MAX_ARROWS)
            this.arrows.shift()
        this.draw = 0
        this.nockTime = - 1
        this.recover = 0.38
        this.stringTime = 0
        this.jolt(0.05)
        this.view.audio.play('bowRelease')
    }

    private updateArrows(dt: number) {
        const matrix = new THREE.Matrix4()
        const scale = new THREE.Vector3(1, 1, 1)
        const particles = this.view.particles
        this.arrows = this.arrows.filter((arrow) => (arrow.age += dt) < 60)
        for (const arrow of this.arrows) {
            if (arrow.stuck)
                continue
            const steps = 6
            for (let s = 0; s < steps && !arrow.stuck; s++) {
                const h = dt / steps
                const v = arrow.velocity
                const p = arrow.position
                if (arrow.floating) {
                    // drifting to a stop on the surface
                    p.addScaledVector(v, h)
                    p.y = WATER_LEVEL - 0.01
                    v.multiplyScalar(Math.exp(- 3 * h))
                    if (v.lengthSq() < 0.01) arrow.stuck = true
                    continue
                }
                const speed = v.length()
                // gravity and a little quadratic drag
                v.multiplyScalar(1 - Math.min(0.5, 0.0045 * speed * h))
                v.y -= 9.81 * h
                const previous = p.clone()
                p.addScaledVector(v, h)
                // the head leads: test there (the position is the shaft's middle)
                const along = v.clone().normalize()
                const head = p.clone().addScaledVector(along, 0.38)
                // a deer: the arrow goes in (and is gone), the deer flinches or falls
                if (this.view.wildlife.hit(head, previous)) {
                    arrow.age = 1e9
                    arrow.stuck = true
                    this.hitMarker = 0.3
                    break
                }
                const ground = this.ground(head.x, head.z)
                const plant = this.state.vegetation.solidAt(head.x, head.y, head.z, 0.02)
                if (head.y < WATER_LEVEL && ground < WATER_LEVEL) {
                    // into the water: a splash, then it floats where it slows down
                    particles.emit('splash', new THREE.Vector3(head.x, WATER_LEVEL, head.z), 8, UP, 2.2, 0.5)
                    p.y = WATER_LEVEL - 0.01
                    v.set(v.x * 0.15, 0, v.z * 0.15)
                    arrow.quaternion.setFromUnitVectors(UP, new THREE.Vector3(v.x, 0, v.z).normalize())
                    arrow.floating = true
                }
                else if (plant?.kind === PLANT.ROCK && speed > 9) {
                    // glances off rock
                    const normal = new THREE.Vector3(head.x - plant.x, 0.4, head.z - plant.z).normalize()
                    particles.emit('spark', head, 8, normal, 3.5, 0.7)
                    v.reflect(normal).multiplyScalar(0.3).add(new THREE.Vector3((Math.random() - 0.5) * 2, Math.random(), (Math.random() - 0.5) * 2))
                    p.copy(previous)
                }
                else if (plant || head.y < ground) {
                    // sticks, driven in deeper the faster it flew
                    const depth = THREE.MathUtils.clamp(speed * (plant ? 0.004 : 0.006), 0.04, plant ? 0.2 : 0.3)
                    const contact = head.clone()
                    if (!plant) {
                        // back along the path to where the head met the ground
                        const before = previous.clone().addScaledVector(along, 0.38)
                        const above = before.y - this.ground(before.x, before.z), below = head.y - ground
                        contact.copy(before).lerp(head, THREE.MathUtils.clamp(above / Math.max(1e-4, above - below), 0, 1))
                    }
                    p.copy(contact).addScaledVector(along, depth - 0.38)
                    arrow.stuck = true
                    arrow.stuckAt = arrow.age
                    this.hitMarker = 0.3
                    this.view.audio.play('arrowHit', contact)
                    arrow.wobbleAxis.crossVectors(along, UP)
                    if (arrow.wobbleAxis.lengthSq() < 1e-3) arrow.wobbleAxis.set(1, 0, 0)
                    arrow.wobbleAxis.normalize()
                    if (plant) {
                        particles.emit('chip', contact, 4, along.clone().negate(), 1.6, 0.6)
                        this.view.trees.strike(plant.x, plant.z, v.x, v.z, 0.25)
                    }
                    else
                        particles.emit('dirt', new THREE.Vector3(contact.x, this.ground(contact.x, contact.z) + 0.02, contact.z), 5, along.clone().negate().setY(1), 1.6, 0.6)
                }
            }
            if (!arrow.stuck && !arrow.floating && arrow.velocity.lengthSq() > 1e-4)
                arrow.quaternion.setFromUnitVectors(UP, arrow.velocity.clone().normalize())
        }
        const wobble = new THREE.Quaternion()
        this.arrows.forEach((arrow, i) => {
            let quaternion = arrow.quaternion
            const since = arrow.age - arrow.stuckAt
            if (arrow.stuck && !arrow.floating && since < 0.8) {
                // a stuck arrow quivers
                wobble.setFromAxisAngle(arrow.wobbleAxis, Math.sin(since * 48) * Math.exp(- since * 7) * 0.12)
                quaternion = wobble.clone().multiply(arrow.quaternion)
            }
            // the arrow's position is its middle; when stuck, the head is in the target
            matrix.compose(arrow.position, quaternion, scale)
            this.arrowMesh.setMatrixAt(i, matrix)
        })
        this.arrowMesh.count = this.arrows.length
        this.arrowMesh.instanceMatrix.needsUpdate = true

        const positions = this.streaks.geometry.getAttribute('position') as THREE.BufferAttribute
        const colors = this.streaks.geometry.getAttribute('color') as THREE.BufferAttribute
        let lines = 0
        for (const arrow of this.arrows) {
            if (arrow.stuck || arrow.floating)
                continue
            const tail = arrow.position.clone().addScaledVector(arrow.velocity, - 0.045)
            positions.setXYZ(lines * 2, tail.x, tail.y, tail.z)
            positions.setXYZ(lines * 2 + 1, arrow.position.x, arrow.position.y, arrow.position.z)
            colors.setXYZ(lines * 2, 0, 0, 0)
            colors.setXYZ(lines * 2 + 1, 0.9, 0.9, 0.85)
            lines++
        }
        this.streaks.geometry.setDrawRange(0, lines * 2)
        positions.needsUpdate = true
        colors.needsUpdate = true
    }

    private createFlame() {
        // soft additive glows, very bright (they bloom)
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 64
        const context = canvas.getContext('2d')!
        const gradient = context.createRadialGradient(32, 36, 2, 32, 32, 30)
        gradient.addColorStop(0, 'rgba(255,255,230,1)')
        gradient.addColorStop(0.3, 'rgba(255,190,90,0.8)')
        gradient.addColorStop(0.7, 'rgba(255,90,20,0.25)')
        gradient.addColorStop(1, 'rgba(255,60,0,0)')
        context.fillStyle = gradient
        context.fillRect(0, 0, 64, 64)
        const texture = new THREE.CanvasTexture(canvas)
        const group = new THREE.Group()
        group.position.y = 0.5
        for (let i = 0; i < 3; i++) {
            const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, color: new THREE.Color(6, 3.4, 1.4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }))
            sprite.scale.setScalar(0.22 - i * 0.05)
            sprite.position.y = i * 0.05
            group.add(sprite)
        }
        return group
    }

    // ── per frame ──

    /** Taking a tool from the body or putting it back: the hand reaches the holster, the tool changes place there. */
    /**
     * Taking a tool out or putting it away, step by step and in plain view, the way it's
     * worn: a blade drawn out of the sheath that stays on the belt (and slid back in); a tool
     * under a guard pulled out and held up while the other hand takes the guard off and puts
     * it in the pouch or sack (and the other way round); the bow reached for over the
     * shoulder and brought round.
     */
    private updateTransition(dt: number) {
        const transition = this.transition!
        transition.time += dt
        const tool = transition.tool
        const holster = this.holsterPose(tool)
        if (!holster)
            return
        const style = STYLE[tool]
        const result = style === 'sheath' ? this.sheathStep(transition, holster)
            : style === 'none' ? this.slingStep(transition, holster)
            : this.guardStep(transition, holster)
        const { pose, weight, off } = result

        // the main hand (the left for the bow) on the tool, the other on the guard
        const hand = frame(pose.dir, pose.edge).multiply(HAND_IN_TOOL)
        const main: HandTarget = { position: pose.grip.clone(), quaternion: hand }
        const other: HandTarget | null = off && off.weight > 0.001 ? { position: off.position, quaternion: off.quaternion, weight: off.weight } : null
        this.pose = tool === 'bow'
            ? { left: main, right: other, weight, twist: 0, lean: 0, lower: 0, pitch: 0 }
            : { right: main, left: other, weight, twist: 0, lean: 0, lower: 0, pitch: 0 }
        this.last = pose
    }

    /** Taking hold of the tool (the moment it leaves its place) and letting go of it. */
    private grab(tool: ToolName) {
        if (this.inHand.has(tool))
            return
        this.inHand.add(tool)
        this.view.audio.play('equip')
    }

    private release(tool: ToolName) {
        if (!this.inHand.has(tool))
            return
        this.inHand.delete(tool)
        this.view.audio.play('equip', undefined, 0.7)
    }

    /** The transition is over: on to the next (put away what was just taken out if the choice changed meanwhile, another tool to take out), or done. */
    private finish(kind: 'draw' | 'stow') {
        this.transition = null
        if (kind === 'draw')
            this.last = this.carryPose([...this.inHand][0] ?? 'sword')
        this.advance()
        if (!this.transition && kind === 'stow')
            this.last = null
    }

    /** Out of the sheath on the belt along its line, and up into the carry (or back in). */
    private sheathStep(transition: NonNullable<Tools['transition']>, holster: Pose) {
        const t = transition.time, tool = transition.tool
        const phase = (from: number, to: number) => smooth(THREE.MathUtils.clamp((t - from) / (to - from), 0, 1))
        const cover = this.covers.get(transition.tool)!
        // the way out of the sheath (character space): the tool moves against its cover's way off
        const out = (cover.userData.off as THREE.Vector3).clone().applyQuaternion(frame(holster.dir, holster.edge)).negate()
        const clear = { ...holster, grip: holster.grip.clone().addScaledVector(out, cover.userData.distance as number) }
        const carry = this.carryPose(tool)
        this.coverState.get(tool)!.at = 'holster'
        let pose: Pose, weight = 1
        if (transition.kind === 'draw') {
            const S = SHEATHE
            if (t < S.reach) {
                pose = holster
                weight = phase(0, S.reach)
            }
            else {
                this.grab(tool)
                pose = t < S.out ? lerpPose(holster, clear, phase(S.reach, S.out)) : this.swingTo(clear, carry, phase(S.out, S.end))
            }
            if (t >= S.end) this.finish('draw')
        }
        else {
            const S = UNSHEATHE
            const from = transition.from ?? carry
            if (t < S.mouth)
                pose = this.swingTo(from, clear, phase(0, S.mouth))
            else if (t < S.in)
                pose = lerpPose(clear, holster, phase(S.mouth, S.in))
            else {
                pose = holster
                this.release(tool)
                weight = 1 - phase(S.in, S.end)
            }
            if (t >= S.end) {
                this.release(tool)
                this.finish('stow')
            }
        }
        return { pose, weight, off: null }
    }

    /** Reached for over the shoulder and brought round to the front (the bow), or put back. */
    private slingStep(transition: NonNullable<Tools['transition']>, holster: Pose) {
        const t = transition.time, tool = transition.tool
        const phase = (from: number, to: number) => smooth(THREE.MathUtils.clamp((t - from) / (to - from), 0, 1))
        const carry = this.carryPose(tool)
        let pose: Pose, weight = 1
        if (transition.kind === 'draw') {
            const S = UNSLING
            if (t < S.reach) {
                pose = holster
                weight = phase(0, S.reach)
            }
            else {
                this.grab(tool)
                pose = t < S.pull ? this.pullPath(tool, holster, carry, phase(S.reach, S.pull)) : carry
                weight = 1 + (CARRY[tool].weight - 1) * phase(S.pull, S.end)
            }
            if (t >= S.end) this.finish('draw')
        }
        else {
            const S = SLING
            const from = transition.from ?? carry
            if (t < S.pull)
                pose = this.pullPath(tool, holster, from, 1 - phase(0, S.pull))
            else {
                pose = holster
                this.release(tool)
                weight = 1 - phase(S.pull, S.end)
            }
            if (t >= S.end) {
                this.release(tool)
                this.finish('stow')
            }
        }
        return { pose, weight, off: null }
    }

    /** From one pose to another in front of the body, the tool turning the long way over the top if it must. */
    private swingTo(a: Pose, b: Pose, u: number): Pose {
        const via = a.grip.clone().lerp(b.grip, 0.5).add(new THREE.Vector3(0, 0.12, 0.12))
        return {
            grip: bezier(a.grip, via, b.grip, u),
            dir: arcBetween(a.dir, b.dir, u),
            edge: a.edge.clone().lerp(b.edge, u).normalize(),
            twist: a.twist + (b.twist - a.twist) * u, lean: a.lean + (b.lean - a.lean) * u, lower: a.lower + (b.lower - a.lower) * u
        }
    }

    /** Pulled out and held up while the other hand takes the guard off (or puts it on), the guard in the pouch or sack. */
    private guardStep(transition: NonNullable<Tools['transition']>, holster: Pose) {
        const t = transition.time
        const tool = transition.tool
        const present = this.keyPose(PRESENT[tool])
        const carry = this.carryPose(tool)
        const cover = this.coverState.get(tool)!
        const distance = this.covers.get(tool)!.userData.distance as number
        const phase = (from: number, to: number) => smooth(THREE.MathUtils.clamp((t - from) / (to - from), 0, 1))
        const stash = this.stashPoint()
        const by = this.byTheHip()
        let pose: Pose, weight = 1
        let off: { position: THREE.Vector3, quaternion: THREE.Quaternion | null, weight: number } | null = null

        if (transition.kind === 'draw') {
            const D = DRAW
            if (t < D.reach) {
                pose = holster
                weight = phase(0, D.reach)
            }
            else {
                this.grab(tool)
                pose = t < D.pull ? this.pullPath(tool, holster, present, phase(D.reach, D.pull)) : t < D.stash ? present : lerpPose(present, carry, phase(D.stash, D.end))
                if (t >= D.pull && t < D.end) {
                    const toCover = phase(D.pull, D.cover)
                    if (t < D.slide) {
                        // the other hand to the guard, then sliding it off
                        cover.at = 'tool'
                        cover.slide = phase(D.cover, D.slide) * distance
                        off = { ...this.coverHold(tool, present), weight: toCover }
                        if (cover.slide > 0.02 && !transition.sounded) {
                            transition.sounded = true
                            this.view.audio.play('equip', undefined, 0.6)
                        }
                    }
                    else {
                        // into the pouch or sack with it, by the hip, and the hand back
                        cover.at = t < D.stash ? 'hand' : 'bag'
                        const from = this.coverHold(tool, present)
                        const position = t < D.stash ? bezier(from.position, by, stash, phase(D.slide, D.stash)) : stash
                        off = { position, quaternion: null, weight: 1 - phase(D.stash, D.end) }
                    }
                }
            }
            if (t >= D.end) {
                cover.at = 'bag'
                this.finish('draw')
            }
        }
        else {
            const S = STOW
            const from = transition.from ?? carry
            if (t < S.present) {
                // up in front; the other hand reaches into the pouch or sack for the guard
                pose = lerpPose(from, present, phase(0, S.present))
                cover.at = 'bag'
                off = { position: stash, quaternion: null, weight: phase(0, S.present) }
            }
            else if (t < S.slide) {
                // the guard out, up to the blade and slid home
                pose = present
                cover.at = t < S.bring ? 'hand' : 'tool'
                if (t < S.bring) {
                    const target = this.coverHold(tool, present, distance)
                    off = { position: bezier(stash, by, target.position, phase(S.present, S.bring)), quaternion: null, weight: 1 }
                }
                else {
                    cover.slide = (1 - phase(S.bring, S.slide)) * distance
                    off = { ...this.coverHold(tool, present, cover.slide), weight: 1 }
                }
            }
            else {
                // back where it's worn; the other hand lets go of it
                cover.at = 'tool'
                cover.slide = 0
                pose = t < S.put ? this.pullPath(tool, holster, present, 1 - phase(S.slide, S.put)) : holster
                off = { ...this.coverHold(tool, present), weight: 1 - phase(S.slide, S.slide + 0.25) }
                weight = 1 - phase(S.put, S.end)
                if (t >= S.put)
                    this.release(tool)
            }
            if (t >= S.end) {
                this.release(tool)
                this.finish('stow')
            }
        }
        return { pose, weight, off }
    }

    /** A key's pose (character space). */
    private keyPose(key: Key): Pose {
        return { grip: vector(key.grip), dir: vector(key.dir).normalize(), edge: vector(key.edge ?? [0, 0, 1]), twist: 0, lean: 0, lower: 0 }
    }

    /**
     * From the bag to in front (u 0 .. 1): up over the shoulder for what sits high on the bag,
     * round by the hip for what's held low, the tool turning the long way over the top.
     */
    private pullPath(tool: ToolName, holster: Pose, present: Pose, u: number): Pose {
        const high = holster.grip.y > 1.25
        const side = tool === 'bow' ? 1 : - 1
        const via = high ? new THREE.Vector3(side * 0.22, Math.max(holster.grip.y, 1.5) + 0.22, 0.02) : new THREE.Vector3(side * 0.42, 1.0, 0.05)
        return {
            grip: bezier(holster.grip, via, present.grip, u),
            dir: arcBetween(holster.dir, present.dir, u),
            edge: holster.edge.clone().lerp(present.edge, u).normalize(),
            twist: 0, lean: 0, lower: 0
        }
    }

    /** Where the other hand holds the cover, for the tool in this pose with the cover slid `slide` along its way off. */
    private coverHold(tool: ToolName, pose: Pose, slide = this.coverState.get(tool)!.slide) {
        const cover = this.covers.get(tool)!
        const orientation = frame(pose.dir, pose.edge)
        const local = (cover.userData.grip as THREE.Vector3).clone().addScaledVector(cover.userData.off as THREE.Vector3, slide)
        return { position: pose.grip.clone().add(local.applyQuaternion(orientation)), quaternion: orientation.clone().multiply(HAND_IN_TOOL) }
    }

    /** The mouth of the pouch or sack the guards go in (character space). */
    private stashPoint() {
        const bone = this.view.player.boneFrame('pelvis')
        if (!bone)
            return new THREE.Vector3(0.2, 0.95, - 0.12)
        return this.toLocal(vector(STASH[this.kind]).applyQuaternion(bone.quaternion).add(bone.position)).sub(this.view.player.chestShift)
    }

    /** A point out by the left hip the other hand passes on its way to the pouch or sack. */
    private byTheHip() {
        return new THREE.Vector3(0.36, 1.0, 0.12)
    }

    private updateSwing(dt: number) {
        const swing = this.swing!
        const player = this.state.player
        if (this.freeze > 0)
            this.freeze -= dt
        else
            swing.time += dt
        const def = swing.def
        const end = swing.keys[swing.keys.length - 1].t
        const pose = this.strokePose(swing.tool, swing.keys, Math.min(swing.time, end))
        this.holdPose(swing.tool, pose, 1)
        this.last = pose
        // the whoosh as the stroke comes through
        if (!swing.whooshed && !swing.recoil && swing.time >= def.active[0] - 0.04) {
            swing.whooshed = true
            this.view.audio.play(swing.tool === 'axe' || swing.tool === 'hoe' ? 'heavySwing' : 'swing')
        }
        // a step into the strike
        if (def.step && !swing.stepped && swing.time >= def.step[0] && (player.grounded || def.special === 'leap')) {
            swing.stepped = true
            // forward, back or to a side of the way the character faces
            const turn = { forward: 0, back: Math.PI, left: Math.PI / 2, right: - Math.PI / 2 }[def.step[2] ?? 'forward']
            player.stepForward(Math.sin(this.facing + turn), Math.cos(this.facing + turn), def.step[1], def.special === 'leap' ? 0.4 : 0.12)
        }
        // the spin turns the whole body once round during its live part
        if (def.special === 'spin' && !swing.recoil) {
            const [from, to] = [def.keys[1].t, def.keys[3].t]
            const u = THREE.MathUtils.clamp((swing.time - from) / (to - from), 0, 1)
            player.forcedRotation = u > 0 && u < 1 ? swing.spinFrom + u * u * (3 - 2 * u) * Math.PI * 2 : null
        }
        // a small hop up into the uppercut
        if (def.special === 'hop' && !swing.landed && swing.time >= def.keys[1].t && player.grounded) {
            swing.landed = true
            player.velocity[1] = 3.5
            player.grounded = false
        }
        // the plunge and the leap end in a blow to the ground: dust, a jolt, flattened grass
        if ((def.special === 'plunge' || def.special === 'leap') && !swing.landed && swing.time > 0.15 && player.grounded) {
            swing.landed = true
            const p = player.position.current
            const at = new THREE.Vector3(p[0], p[1], p[2]).add(new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing)).multiplyScalar(0.9))
            for (let i = 0; i < 8; i++) {
                const a = i / 8 * Math.PI * 2
                this.view.particles.emit('dust', at.clone().add(new THREE.Vector3(Math.cos(a) * 0.8, 0.1, Math.sin(a) * 0.8)), 2, new THREE.Vector3(Math.cos(a), 0.4, Math.sin(a)), 2.2, 0.4)
            }
            this.view.grass.trail.cut(at.x, at.z, 2.2, 0.9)
            this.view.audio.play('land', at, 1.3)
            this.jolt(def.special === 'leap' ? 0.45 : 0.3)
        }
        // the next stroke when asked for in time (or the button held), else back to the carry
        const wantsMore = swing.queued || this.useHeld
        const heavy = HEAVY[swing.tool]?.includes(swing.name)
        if (!heavy && def.chain !== undefined && swing.time >= def.chain && wantsMore)
            this.startSwing(swing.tool, this.lightStroke(swing.tool))
        else if (swing.time >= end) {
            this.swing = null
            this.lastStroke = this.state.time.elapsed
            player.forcedRotation = null
            if (this.useHeld)
                this.startSwing(swing.tool, this.lightStroke(swing.tool))
        }
    }

    /**
     * The bow, as an archer shoots: side-on to the mark (hips and chest turned), the bow arm
     * straight out from the left shoulder toward it. Each shot the right hand takes an arrow
     * from the quiver at the hip, brings it up to the bow and nocks it on the string, then
     * draws: the hand straight back along the arrow to the corner of the mouth, the elbow
     * behind in line with it. Let go, the string hand flies back past the jaw.
     */
    private updateBow(dt: number) {
        if (this.nockTime >= 0 && this.nockTime < NOCK.end) {
            this.nockTime += dt
            if (this.nockTime >= NOCK.end)
                this.view.audio.play('bowDraw')
        }
        const nocked = this.nockTime >= NOCK.end
        if (nocked && this.pendingRelease) {
            this.pendingRelease = false
            this.draw = Math.max(this.draw, 0.3)
            this.shoot()
            this.aiming = false
        }
        else if (nocked && this.aiming)
            this.draw = Math.min(1, this.draw + dt / 0.7)
        if (this.aimLift > 0) {
            this.aimLift = Math.max(0, this.aimLift - dt)
            const camera = this.state.player.camera.thirdPerson
            const level = Math.PI * 0.475
            if (camera.phi < level)
                camera.phi += (level - camera.phi) * (1 - Math.exp(- dt * 14))
        }
        this.recover = Math.max(0, this.recover - dt)

        const player = this.view.player
        const local = (name: string, fallback: V3) => {
            const bone = player.bone(name)
            return bone ? this.toLocal(bone.getWorldPosition(new THREE.Vector3())).sub(player.chestShift) : vector(fallback)
        }
        const aim = this.aimLocal()
        const right = new THREE.Vector3().crossVectors(aim, UP).normalize()
        // up into the shot while the arrow is fetched; down again a moment after it's loosed
        const raise = this.nockTime >= 0 ? smooth(THREE.MathUtils.clamp(this.nockTime / NOCK.bow, 0, 1)) : this.recover > 0 ? smooth(this.recover / 0.38) : 0
        const shoulder = local('upperarm_l', [0.18, 1.42, 0])
        const head = local('Head', [0, 1.62, 0.02])
        const bowAt = shoulder.clone().addScaledVector(aim, 0.6)
        const bowUp = UP.clone().addScaledVector(aim, - aim.y).normalize().applyAxisAngle(aim, - 0.12)
        const nockAt = bowAt.clone().addScaledVector(aim, - 0.15).addScaledVector(right, 0.02)
        // the anchor: the corner of the mouth, on the right
        const anchor = head.clone().addScaledVector(aim, 0.08).addScaledVector(UP, - 0.08).addScaledVector(right, 0.045)
        const quiverBone = player.boneFrame('pelvis')
        const quiver = quiverBone ? this.toLocal(vector(QUIVER_MOUTH).applyQuaternion(quiverBone.quaternion).add(quiverBone.position)).sub(player.chestShift) : new THREE.Vector3(- 0.23, 1.2, - 0.17)

        // the right hand: to the quiver, the arrow up to the bow, then the draw
        let stringHand: THREE.Vector3, stringWeight = 1
        let stringQuaternion: THREE.Quaternion | null = null
        const drawing = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(aim, bowUp), aim, bowUp))
        if (this.nockTime >= 0 && !nocked) {
            const t = this.nockTime
            if (t < NOCK.quiver) {
                stringHand = quiver
                stringWeight = smooth(t / NOCK.quiver)
            }
            else {
                const u = smooth(THREE.MathUtils.clamp((t - NOCK.quiver) / (NOCK.bow - NOCK.quiver), 0, 1))
                stringHand = bezier(quiver, quiver.clone().add(new THREE.Vector3(- 0.05, 0.35, 0.2)), nockAt, u)
                stringQuaternion = u > 0.6 ? drawing : null
            }
        }
        else if (nocked) {
            const draw = 1 - Math.pow(1 - this.draw, 2)
            stringHand = nockAt.clone().lerp(anchor, draw)
            stringQuaternion = drawing
        }
        else {
            // loosed: the hand flies back past the jaw, then drops
            const kick = Math.sin(Math.min(1, (0.38 - this.recover) / 0.38) * Math.PI)
            stringHand = anchor.clone().addScaledVector(aim, - 0.1 * kick).addScaledVector(right, 0.06 * kick)
            stringQuaternion = drawing
            stringWeight = smooth(this.recover / 0.38)
        }
        const kick = this.recover > 0 && !nocked ? Math.sin(Math.min(1, (0.38 - this.recover) / 0.38) * Math.PI) : 0

        // the bow hand: from the carry up to the shot
        const carry = this.carryPose('bow')
        const bowHand = carry.grip.clone().lerp(bowAt.addScaledVector(aim, kick * 0.03), raise)
        const bowQuaternion = frame(carry.dir, carry.edge).slerp(frame(bowUp, aim), raise).multiply(HAND_IN_TOOL)
        this.pose = {
            left: { position: bowHand, quaternion: bowQuaternion, pole: new THREE.Vector3(1, - 0.35, - 0.1) },
            right: { position: stringHand, quaternion: stringQuaternion, pole: aim.clone().negate().addScaledVector(right, 0.35).addScaledVector(UP, 0.1).normalize(), weight: stringWeight },
            weight: 1,
            twist: - 1.0 * raise,
            hips: - 0.45 * raise,
            lean: 0,
            lower: 0,
            pitch: - Math.asin(THREE.MathUtils.clamp(aim.y, - 1, 1)) * 0.5 * raise
        }
    }

    /** The arrow on its way from the quiver to the string, in the fingers. */
    private placeArrowInHand() {
        const carrying = this.equipped === 'bow' && this.nockTime >= NOCK.quiver && this.nockTime < NOCK.end
        this.arrowInHand.visible = carrying
        if (!carrying)
            return
        const hand = this.view.player.bone('hand_r')
        const model = this.view.player.model
        if (!hand || !model)
            return
        hand.updateWorldMatrix(true, false)
        const fingers = GRIP_RIGHT.clone().applyMatrix4(hand.matrixWorld)
        // head down out of the quiver, turning toward the mark as it comes up to the bow
        const u = smooth(THREE.MathUtils.clamp((this.nockTime - NOCK.quiver) / (NOCK.bow - NOCK.quiver), 0, 1))
        const aim = this.view.camera.instance.getWorldDirection(new THREE.Vector3())
        const down = new THREE.Vector3(0, - 1, 0)
        const along = arcBetween(down, aim.normalize(), u)
        this.arrowInHand.quaternion.setFromUnitVectors(UP, along)
        this.arrowInHand.position.copy(fingers).addScaledVector(along, 0.32)
    }

    /** Advance strokes, the bow and the hands' transitions; set this frame's targets for the body. */
    update() {
        const dt = Math.min(this.state.time.delta, 0.05)
        const player = this.state.player
        if (this.moveLabelTime > 0) {
            this.moveLabelTime -= dt
            if (this.moveLabelTime <= 0) this.moveLabel.classList.remove('is-shown')
        }
        const previous = this.held
        this.pose = { right: null, left: null, weight: 0, twist: 0, lean: 0, lower: 0, pitch: 0 }

        // put the tool away to swim or climb
        if ((this.equipped || this.transition) && (player.swimming || player.climbing || player.mantle)) {
            if (this.equipped) this.inHand.delete(this.equipped)
            this.inHand.clear()
            this.resetCovers()
            this.equipped = null
            this.swing = null
            this.aiming = false
            this.transition = null
            this.renderHotbar()
        }

        const tool = this.equipped
        if (this.transition)
            this.updateTransition(dt)
        else if (this.swing)
            this.updateSwing(dt)
        else if (tool === 'bow' && (this.aiming || this.recover > 0 || this.nockTime >= 0))
            this.updateBow(dt)
        else if (tool && this.inHand.has(tool)) {
            // carried (the torch raised while the button is held)
            const carry = this.carryPose(tool)
            // a gentle sway with the walk (the held arm no longer swings freely, which made
            // half-blended poses wobble and flip)
            const gait = this.view.player.gait
            const swing = Math.sin(gait.phase * Math.PI * 2) * gait.moving
            const bob = Math.abs(Math.cos(gait.phase * Math.PI * 2)) * gait.moving
            if (tool === 'torch') {
                // the torch arm swings with the stride (bent at the elbow, against the right
                // leg), higher and pumping when running; the torch leans into the pace and
                // lags the arm, swinging past and back
                const run = THREE.MathUtils.smoothstep(player.speed, player.walkSpeed + 0.5, player.walkSpeed + 2.5) * gait.moving
                const reach = 0.06 + run * 0.08
                carry.grip.add(new THREE.Vector3(- run * 0.04, bob * 0.025 + run * 0.06 + Math.max(0, swing) * run * 0.06, swing * reach))
                const target = - swing * (0.16 + run * 0.1) + gait.moving * 0.08 + run * 0.18
                this.torchTiltSpeed += ((target - this.torchTilt) * 90 - this.torchTiltSpeed * 11) * dt
                this.torchTilt += this.torchTiltSpeed * dt
                carry.dir.applyAxisAngle(new THREE.Vector3(1, 0, 0), this.torchTilt).normalize()
                carry.edge.applyAxisAngle(new THREE.Vector3(1, 0, 0), this.torchTilt)
            }
            else {
                carry.grip.add(new THREE.Vector3(0, bob * 0.02 - gait.moving * 0.01, (tool === 'bow' ? - swing : swing) * (SECOND_HAND[tool] !== undefined ? 0.025 : 0.07)))
                carry.dir.applyAxisAngle(new THREE.Vector3(1, 0, 0), (tool === 'bow' ? swing : - swing) * 0.08).normalize()
            }
            if (tool === 'torch') {
                this.raised += ((this.useHeld ? 1 : 0) - this.raised) * (1 - Math.exp(- dt * 8))
                carry.grip.lerp(new THREE.Vector3(- 0.2, 1.68, 0.3), this.raised)
                carry.dir.lerp(new THREE.Vector3(0, 1, 0.1), this.raised).normalize()
            }
            this.holdPose(tool, carry, CARRY[tool].weight, CARRY[tool].pole)
            this.last = carry
        }
        else
            this.last = null

        // ease the hands in and out of the tool's control (fading out: toward the last targets)
        const want = this.pose.weight
        this.handWeight += (want - this.handWeight) * (1 - Math.exp(- dt * (want > this.handWeight ? 24 : 10)))
        if (want > 0)
            this.held = { right: this.pose.right, left: this.pose.left }
        else if (this.handWeight > 0.01) {
            this.pose.right = previous.right
            this.pose.left = previous.left
        }
        this.pose.weight = this.handWeight

        // face where the camera looks while aiming or striking
        // the feet slow while the hands are busy: a stroke (not the running cut or the leap),
        // drawing or putting away, aiming the bow
        const busy = this.swing && !['running', 'leap', 'plunge'].includes(this.swing.name) ? 0.55 : this.transition ? 0.75 : this.aiming ? 0.5 : 1
        player.actionPace += (busy - player.actionPace) * (1 - Math.exp(- dt * 8))
        // with a tool in hand: face where the camera looks (step back with S, sideways with A/D)
        player.stance = !!tool && (this.inHand.has(tool) || this.transition !== null) && !player.swimming && !player.climbing && !player.mantle
        player.aimYaw = this.aiming || this.swing !== null || player.stance ? player.camera.thirdPerson.theta : null
        player.camera.thirdPerson.aim = this.aiming ? 1 : 0
        this.crosshair.hidden = !(this.aiming || (tool === 'bow' && (this.recover > 0 || this.hitMarker > 0)))
        this.crosshair.style.setProperty('--draw', this.draw.toFixed(3))
        this.hitMarker = Math.max(0, this.hitMarker - dt)
        this.crosshair.classList.toggle('is-hit', this.hitMarker > 0)
        this.updateArrows(dt)
        this.trail.update(dt)
    }

    /** Put the tools where they are (in the hand or on the body), after the character is posed. */
    place() {
        this.updateStored()
        const set = this.set
        for (const tool of set) {
            const model = this.models.get(tool)!
            if (this.inHand.has(tool)) {
                const bone = this.view.player.bone(tool === 'bow' ? 'hand_l' : 'hand_r')
                if (!bone)
                    continue
                bone.updateWorldMatrix(true, false)
                const handQuaternion = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(bone.matrixWorld))
                const grip = (tool === 'bow' ? GRIP_LEFT : GRIP_RIGHT).clone().applyQuaternion(handQuaternion)
                model.position.setFromMatrixPosition(bone.matrixWorld).add(grip)
                model.quaternion.copy(handQuaternion).multiply(HAND_IN_TOOL)
            }
            else {
                const holster = this.holsterWorld(tool)
                if (!holster)
                    continue
                model.position.copy(holster.position)
                model.quaternion.copy(holster.quaternion)
            }
        }
        this.placeGear()
        this.placeCovers()

        this.placeString()
        this.placeArrowInHand()
        this.testHits()
        this.placeTorch()
        this.placeClimbingAxes()
    }

    /**
     * The cut in a trunk being felled: fresh pale wood on the side the chops come from, wider
     * and deeper as it goes (progress 0 .. 1 of the chops it takes).
     */
    private notch(plant: Plant, point: THREE.Vector3, progress: number) {
        let notch = this.notches.get(plant)
        if (!notch) {
            // a felling notch: a level lower cut and a sloping upper one meeting inside the
            // trunk; unit size, its mouth on the bark (z = 0), reaching in to z = -1
            const geometry = new THREE.BufferGeometry()
            const v = [
                // upper cut: from the top of the mouth down to the back of the notch
                - 0.5, 0.5, 0, 0.5, 0.5, 0, 0.5, - 0.5, - 1, - 0.5, 0.5, 0, 0.5, - 0.5, - 1, - 0.5, - 0.5, - 1,
                // lower cut: level, from the mouth to the back
                - 0.5, - 0.5, 0, - 0.5, - 0.5, - 1, 0.5, - 0.5, - 1, - 0.5, - 0.5, 0, 0.5, - 0.5, - 1, 0.5, - 0.5, 0,
                // the ends
                - 0.5, 0.5, 0, - 0.5, - 0.5, - 1, - 0.5, - 0.5, 0, 0.5, 0.5, 0, 0.5, - 0.5, 0, 0.5, - 0.5, - 1
            ]
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(v, 3))
            const shade = [0.95, 0.95, 0.72, 0.95, 0.72, 0.72, 1, 0.8, 0.8, 1, 0.8, 1, 0.82, 0.7, 0.82, 0.82, 0.82, 0.7]
            geometry.setAttribute('color', new THREE.Float32BufferAttribute(shade.flatMap((k) => [k, k, k]), 3))
            geometry.computeVertexNormals()
            // fresh wood, pale even in the shade; drawn pulled toward the eye by the cut's depth
            // (along the line of sight, so it stays where it is on screen): the bark it's cut
            // into doesn't hide it, anything nearer (the woodcutter) still does
            const material = new THREE.MeshStandardMaterial({ color: '#dcbc8c', roughness: 0.9, vertexColors: true, side: THREE.DoubleSide, emissive: '#3c2c18' })
            const pull = { value: 0 }
            material.onBeforeCompile = (shader) => {
                shader.uniforms.uPull = pull
                shader.vertexShader = 'uniform float uPull;\n' + shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
                    mvPosition.xyz *= max(0.05, 1.0 - uPull / max(length(mvPosition.xyz), 0.001));
                    gl_Position = projectionMatrix * mvPosition;`)
            }
            const mesh = new THREE.Mesh(geometry, material)
            mesh.userData.pull = pull
            notch = new THREE.Group()
            notch.add(mesh)
            const toward = new THREE.Vector3(point.x - plant.x, 0, point.z - plant.z)
            if (toward.lengthSq() < 1e-6) toward.set(1, 0, 0)
            notch.userData = { toward: toward.normalize(), y: THREE.MathUtils.clamp(point.y, plant.y + 0.35, plant.y + 1.3) }
            this.notches.set(plant, notch)
            this.view.scene.add(notch)
            if (this.notches.size > 16)
                this.removeNotch(this.notches.keys().next().value!)
        }
        const radius = this.view.trees.trunkRadius(plant, notch.userData.y - plant.y)
        const toward = notch.userData.toward as THREE.Vector3
        // the mouth just proud of the bark, wider and deeper with each chop
        notch.position.set(plant.x, notch.userData.y, plant.z).addScaledVector(toward, radius * 0.97)
        notch.lookAt(notch.position.clone().add(toward))
        notch.scale.set(radius * (0.9 + progress * 0.6), 0.07 + progress * 0.2, 0.02 + progress * radius * 1.05)
        ;(notch.children[0].userData.pull as { value: number }).value = notch.scale.z + radius * 0.35
    }

    private removeNotch(plant: Plant) {
        const notch = this.notches.get(plant)
        if (!notch)
            return
        this.view.scene.remove(notch)
        notch.traverse((object) => { const mesh = object as THREE.Mesh; if (mesh.isMesh) { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose() } })
        this.notches.delete(plant)
    }

    /** A short line by the toolbar: the move just started (or a tree's chops). */
    private showLabel(html: string) {
        this.moveLabel.innerHTML = html
        this.moveLabel.classList.add('is-shown')
        this.moveLabelTime = 1.3
    }

    /** The quiver, pouch or sack on the belt. */
    private placeGear() {
        const items = this.gear[this.kind]
        GEAR[this.kind].forEach((item, i) => {
            const bone = this.view.player.boneFrame(item.bone)
            if (!bone)
                return
            items[i].position.copy(vector(item.position).applyQuaternion(bone.quaternion).add(bone.position))
            items[i].quaternion.copy(bone.quaternion).multiply(frame(vector(item.dir), vector(item.edge)))
        })
    }

    /**
     * The covers: on their tools (slid part way off while being taken off or put on), in the
     * other hand on the way to or from the bag, or out of sight in the bag.
     */
    private placeCovers() {
        for (const tool of this.set) {
            const cover = this.covers.get(tool)!
            const state = this.coverState.get(tool)!
            cover.visible = state.at !== 'bag' && STYLE[tool] !== 'none'
            if (state.at === 'holster') {
                // a sheath stays on the belt, the blade drawn out of it
                const holster = this.holsterWorld(tool)
                if (holster) {
                    cover.position.copy(holster.position)
                    cover.quaternion.copy(holster.quaternion)
                }
            }
            else if (state.at === 'tool') {
                const model = this.models.get(tool)!
                model.updateMatrixWorld(true)
                cover.position.copy(cover.userData.off as THREE.Vector3).multiplyScalar(state.slide).applyMatrix4(model.matrixWorld)
                cover.quaternion.copy(model.quaternion)
            }
            else if (state.at === 'hand') {
                // held as a handle is: its grip in the palm, along the hand
                const bone = this.view.player.bone(tool === 'bow' ? 'hand_r' : 'hand_l')
                if (!bone)
                    continue
                bone.updateWorldMatrix(true, false)
                const hand = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(bone.matrixWorld))
                cover.quaternion.copy(hand).multiply(HAND_IN_TOOL)
                cover.position.setFromMatrixPosition(bone.matrixWorld)
                    .add((tool === 'bow' ? GRIP_RIGHT : GRIP_LEFT).clone().applyQuaternion(hand))
                    .sub((cover.userData.grip as THREE.Vector3).clone().applyQuaternion(cover.quaternion))
            }
        }
    }

    /** The climbing axes in the hands while climbing a tall face. */
    private placeClimbingAxes() {
        const player = this.state.player
        const show = player.climbing && player.climbGear
        this.climbingAxes.forEach((axe, i) => {
            axe.visible = show
            if (!show) return
            const bone = this.view.player.bone(i === 0 ? 'hand_l' : 'hand_r')
            if (!bone) return
            bone.updateWorldMatrix(true, false)
            const hand = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(bone.matrixWorld))
            axe.position.setFromMatrixPosition(bone.matrixWorld).add((i === 0 ? GRIP_LEFT : GRIP_RIGHT).clone().applyQuaternion(hand))
            axe.quaternion.copy(hand).multiply(HAND_IN_TOOL)
        })
    }

    /** A hold taken while climbing: the axe's pick bites the rock (dust, a clink), a foot scuffs. */
    climbPlant(limb: number, at: THREE.Vector3, gear: boolean) {
        const n = this.state.player.climbNormal
        const normal = new THREE.Vector3(n[0], n[1], n[2])
        if (limb < 2 && gear) {
            const axe = this.climbingAxes[limb]
            axe.updateMatrixWorld(true)
            const tip = new THREE.Vector3(0, 0.42, 0.19).applyMatrix4(axe.matrixWorld)
            this.view.particles.emit('dirt', tip, 4, normal, 1.2, 0.6)
            this.view.particles.emit('spark', tip, 3, normal, 1.6, 0.8)
            this.view.audio.play('pick', tip)
        }
        else if (limb >= 2)
            this.view.particles.emit('dirt', at, 2, normal, 0.6, 0.8)
    }

    /** The bow's string pulled to the drawing fingers with an arrow nocked, quivering after the shot. */
    private placeString() {
        const bow = this.models.get('bow')
        if (!bow || !this.set.includes('bow'))
            return
        bow.updateMatrixWorld(true)
        const string = bow.getObjectByName('string') as THREE.Line
        const positions = string.geometry.getAttribute('position') as THREE.BufferAttribute
        const nock = new THREE.Vector3(0, 0, - 0.13)
        const drawing = this.equipped === 'bow' && this.inHand.has('bow') && this.nockTime >= NOCK.end
        const hand = this.view.player.bone('hand_r')
        if (drawing && hand) {
            hand.updateWorldMatrix(true, false)
            const fingers = bow.worldToLocal(GRIP_RIGHT.clone().applyMatrix4(hand.matrixWorld))
            nock.y = THREE.MathUtils.clamp(fingers.y, - 0.1, 0.1)
            nock.z = Math.min(- 0.13, fingers.z)
        }
        else {
            this.stringTime += Math.min(this.state.time.delta, 0.05)
            nock.z += Math.sin(this.stringTime * 70) * Math.exp(- this.stringTime * 12) * 0.03
        }
        positions.setXYZ(1, nock.x, nock.y, nock.z)
        positions.needsUpdate = true
        // the nocked arrow lies from the string over the bow hand toward the target
        this.nocked.visible = drawing
        if (this.nocked.visible) {
            const nockWorld = bow.localToWorld(nock.clone())
            const front = bow.localToWorld(new THREE.Vector3(0, 0, 0.05))
            const along = front.sub(nockWorld).normalize()
            this.nocked.quaternion.setFromUnitVectors(UP, along)
            this.nocked.position.copy(nockWorld).addScaledVector(along, 0.33)
        }
    }

    /** The torch: a flickering flame and rising embers, lighting the character and the land around. */
    private placeTorch() {
        const torch = this.view.sky.uniforms.uTorch.value as THREE.Vector4
        const lit = this.inHand.has('torch') && this.set.includes('torch') && this.coverState.get('torch')!.at !== 'tool'
        for (const sprite of this.flame.children)
            sprite.visible = lit
        if (!lit) {
            torch.w = 0
            this.flameLight.intensity = 0
            return
        }
        const dt = Math.min(this.state.time.delta, 0.05)
        this.flicker += (Math.random() - 0.5) * 0.4
        this.flicker *= 0.85
        const strength = (3.2 + this.raised * 0.8) * (0.88 + 0.12 * Math.sin(this.state.time.elapsed * 23) + this.flicker * 0.3)
        this.flame.updateWorldMatrix(true, false)
        const at = new THREE.Vector3().setFromMatrixPosition(this.flame.matrixWorld)
        torch.set(at.x, at.y, at.z, strength)
        this.flameLight.position.copy(at)
        this.flameLight.intensity = strength * 2.2
        this.flame.children.forEach((sprite, i) => sprite.scale.setScalar((0.22 - i * 0.05) * (0.9 + Math.random() * 0.2)))
        this.emberTime += dt
        if (this.emberTime > 0.09) {
            this.emberTime = 0
            this.view.particles.emit('ember', at, 1, UP, 0.8, 0.5)
        }
    }
}
