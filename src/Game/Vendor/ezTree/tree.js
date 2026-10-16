// Tree geometry generator from EZ-Tree by Daniel Greenheck (MIT licence, see LICENSE),
// https://github.com/dgreenheck/ez-tree, trimmed for Generate Infinite: geometry only (the
// game draws trees with its own instanced materials), no textures, presets loader or trellis.
import * as THREE from 'three';
import RNG from './rng';
import { Branch } from './branch';
import { Billboard, TreeType } from './enums';
import TreeOptions from './options';

export class Tree extends THREE.Group {
  /**
   * @type {RNG}
   */
  rng;

  /**
   * @type {TreeOptions}
   */
  options;

  /**
   * @type {Branch[]}
   */
  branchQueue = [];

  /**
   * @param {TreeOptions} params
   */
  constructor(options = new TreeOptions()) {
    super();
    this.name = 'Tree';
    this.branchesMesh = new THREE.Mesh();
    this.leavesMesh = new THREE.Mesh();
    this.add(this.branchesMesh);
    this.add(this.leavesMesh);
    this.options = options;
  }

  /**
   * Loads a tree from JSON
   * @param {TreeOptions} json 
   */
  loadFromJson(json) {
    this.options.copy(json);
    this.generate();
  }

  /**
   * Generate a new tree
   */
  generate() {
    // Clean up old geometry
    this.branches = {
      verts: [],
      normals: [],
      indices: [],
      uvs: [],
      windFactor: [],
      levels: [] // branch level of each triangle (Generate Infinite: levels of detail)
    };

    this.leaves = {
      verts: [],
      normals: [],
      indices: [],
      uvs: [],
    };

    this.rng = new RNG(this.options.seed);

    // Create the trunk of the tree first
    this.branchQueue.push(
      new Branch(
        new THREE.Vector3(),
        new THREE.Euler(),
        this.options.branch.length[0],
        this.options.branch.radius[0],
        0,
        this.options.branch.sections[0],
        this.options.branch.segments[0],
      ),
    );

    while (this.branchQueue.length > 0) {
      const branch = this.branchQueue.shift();
      this.generateBranch(branch);
    }

    this.createBranchesGeometry();
    this.createLeavesGeometry();
  }

  /**
   * Generates a new branch
   * @param {Branch} branch
   * @returns
   */
  generateBranch(branch) {
    // Used later for geometry index generation
    const indexOffset = this.branches.verts.length / 3;

    let sectionOrientation = branch.orientation.clone();
    let sectionOrigin = branch.origin.clone();
    let sectionLength =
      branch.length /
      branch.sectionCount /
      (this.options.type === 'Deciduous' ? this.options.branch.levels - 1 : 1);

    // This information is used for generating child branches after the branch
    // geometry has been constructed
    let sections = [];

    for (let i = 0; i <= branch.sectionCount; i++) {
      let sectionRadius = branch.radius;

      // If final section of final level, set radius to effecively zero
      if (
        i === branch.sectionCount &&
        branch.level === this.options.branch.levels
      ) {
        sectionRadius = 0.001;
      } else if (this.options.type === TreeType.Deciduous) {
        sectionRadius *=
          1 - this.options.branch.taper[branch.level] * (i / branch.sectionCount);
      } else if (this.options.type === TreeType.Evergreen) {
        // Evergreens do not have a terminal branch so they have a taper of 1
        sectionRadius *= 1 - (i / branch.sectionCount);
      }

      // Create the segments that make up this section.
      let first;
      for (let j = 0; j < branch.segmentCount; j++) {
        let angle = (2.0 * Math.PI * j) / branch.segmentCount;

        // Create the segment vertex
        const vertex = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle))
          .multiplyScalar(sectionRadius)
          .applyEuler(sectionOrientation)
          .add(sectionOrigin);

        const normal = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle))
          .applyEuler(sectionOrientation)
          .normalize();

        const uv = new THREE.Vector2(
          j / branch.segmentCount,
          (i % 2 === 0) ? 0 : 1,
        );

        this.branches.verts.push(...Object.values(vertex));
        this.branches.normals.push(...Object.values(normal));
        this.branches.uvs.push(...Object.values(uv));

        if (j === 0) {
          first = { vertex, normal, uv };
        }
      }

      // Duplicate the first vertex so there is continuity in the UV mapping
      this.branches.verts.push(...Object.values(first.vertex));
      this.branches.normals.push(...Object.values(first.normal));
      this.branches.uvs.push(1, first.uv.y);

      // Use this information later on when generating child branches
      sections.push({
        origin: sectionOrigin.clone(),
        orientation: sectionOrientation.clone(),
        radius: sectionRadius,
      });

      sectionOrigin.add(
        new THREE.Vector3(0, sectionLength, 0).applyEuler(sectionOrientation),
      );

      // Perturb the orientation of the next section randomly. The higher the
      // gnarliness, the larger potential perturbation
      const gnarliness =
        Math.max(1, 1 / Math.sqrt(sectionRadius)) *
        this.options.branch.gnarliness[branch.level];

      sectionOrientation.x += this.rng.random(gnarliness, -gnarliness);
      sectionOrientation.z += this.rng.random(gnarliness, -gnarliness);

      // Apply growth force to the branch
      const qSection = new THREE.Quaternion().setFromEuler(sectionOrientation);

      const qTwist = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        this.options.branch.twist[branch.level],
      );

      const qForce = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3().copy(this.options.branch.force.direction),
      );

      qSection.multiply(qTwist);
      qSection.rotateTowards(
        qForce,
        this.options.branch.force.strength / sectionRadius,
      );

      // Apply trellis force if enabled
      if (this.options.trellis.enabled) {
        const trellisResult = this.calculateTrellisForce(sectionOrigin, sectionRadius);
        if (trellisResult) {
          const qTrellis = new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            trellisResult.direction,
          );
          qSection.rotateTowards(qTrellis, trellisResult.strength);
        }
      }

      sectionOrientation.setFromQuaternion(qSection);
    }

    this.generateBranchIndices(indexOffset, branch);

    // Deciduous trees have a terminal branch that grows out of the
    // end of the parent branch
    if (this.options.type === 'deciduous') {
      const lastSection = sections[sections.length - 1];

      if (branch.level < this.options.branch.levels) {
        this.branchQueue.push(
          new Branch(
            lastSection.origin,
            lastSection.orientation,
            this.options.branch.length[branch.level + 1],
            lastSection.radius,
            branch.level + 1,
            // Section count and segment count must be same as parent branch
            // since the child branch is growing from the end of the parent branch
            branch.sectionCount,
            branch.segmentCount,
          ),
        );
      } else {
        this.generateLeaf(lastSection.origin, lastSection.orientation);
      }
    }

    // If we are on the last branch level, generate leaves
    if (branch.level === this.options.branch.levels) {
      this.generateLeaves(sections);
    } else if (branch.level < this.options.branch.levels) {
      this.generateChildBranches(
        this.options.branch.children[branch.level],
        branch.level + 1,
        sections);
    }
  }

  /**
   * Generate branches from a parent branch
   * @param {number} count The number of child branches to generate
   * @param {number} level The level of the child branches
   * @param {{
   *  origin: THREE.Vector3,
   *  orientation: THREE.Euler,
   *  radius: number
   * }[]} sections The parent branch's sections
   * @returns
   */
  generateChildBranches(count, level, sections) {
    const radialOffset = this.rng.random();

    for (let i = 0; i < count; i++) {
      // Determine how far along the length of the parent branch the child
      // branch should originate from (0 to 1)
      let childBranchStart = this.rng.random(1.0, this.options.branch.start[level]);

      // Find which sections are on either side of the child branch origin point
      // so we can determine the origin, orientation and radius of the branch
      const sectionIndex = Math.floor(childBranchStart * (sections.length - 1));
      let sectionA, sectionB;
      sectionA = sections[sectionIndex];
      if (sectionIndex === sections.length - 1) {
        sectionB = sectionA;
      } else {
        sectionB = sections[sectionIndex + 1];
      }

      // Find normalized distance from section A to section B (0 to 1)
      const alpha =
        (childBranchStart - sectionIndex / (sections.length - 1)) /
        (1 / (sections.length - 1));

      // Linearly interpolate origin from section A to section B
      const childBranchOrigin = new THREE.Vector3().lerpVectors(
        sectionA.origin,
        sectionB.origin,
        alpha,
      );

      // Linearly interpolate radius
      const childBranchRadius =
        this.options.branch.radius[level] *
        ((1 - alpha) * sectionA.radius + alpha * sectionB.radius);

      // Linearlly interpolate the orientation
      const qA = new THREE.Quaternion().setFromEuler(sectionA.orientation);
      const qB = new THREE.Quaternion().setFromEuler(sectionB.orientation);
      const parentOrientation = new THREE.Euler().setFromQuaternion(
        qB.slerp(qA, alpha),
      );

      // Calculate the angle offset from the parent branch and the radial angle
      const radialAngle = 2.0 * Math.PI * (radialOffset + i / count);
      const q1 = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0),
        this.options.branch.angle[level] / (180 / Math.PI),
      );
      const q2 = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        radialAngle,
      );
      const q3 = new THREE.Quaternion().setFromEuler(parentOrientation);

      const childBranchOrientation = new THREE.Euler().setFromQuaternion(
        q3.multiply(q2.multiply(q1)),
      );

      let childBranchLength =
        this.options.branch.length[level] *
        (this.options.type === TreeType.Evergreen
          ? 1.0 - childBranchStart
          : 1.0);

      this.branchQueue.push(
        new Branch(
          childBranchOrigin,
          childBranchOrientation,
          childBranchLength,
          childBranchRadius,
          level,
          this.options.branch.sections[level],
          this.options.branch.segments[level],
        ),
      );
    }
  }

  /**
   * Logic for spawning child branches from a parent branch's section
   * @param {{
  *  origin: THREE.Vector3,
  *  orientation: THREE.Euler,
  *  radius: number
  * }[]} sections The parent branch's sections
  * @returns
  */
  generateLeaves(sections) {
    const radialOffset = this.rng.random();

    for (let i = 0; i < this.options.leaves.count; i++) {
      // Determine how far along the length of the parent
      // branch the leaf should originate from (0 to 1)
      let leafStart = this.rng.random(1.0, this.options.leaves.start);

      // Find which sections are on either side of the child branch origin point
      // so we can determine the origin, orientation and radius of the branch
      const sectionIndex = Math.floor(leafStart * (sections.length - 1));
      let sectionA, sectionB;
      sectionA = sections[sectionIndex];
      if (sectionIndex === sections.length - 1) {
        sectionB = sectionA;
      } else {
        sectionB = sections[sectionIndex + 1];
      }

      // Find normalized distance from section A to section B (0 to 1)
      const alpha =
        (leafStart - sectionIndex / (sections.length - 1)) /
        (1 / (sections.length - 1));

      // Linearly interpolate origin from section A to section B
      const leafOrigin = new THREE.Vector3().lerpVectors(
        sectionA.origin,
        sectionB.origin,
        alpha,
      );

      // Linearlly interpolate the orientation
      const qA = new THREE.Quaternion().setFromEuler(sectionA.orientation);
      const qB = new THREE.Quaternion().setFromEuler(sectionB.orientation);
      const parentOrientation = new THREE.Euler().setFromQuaternion(
        qB.slerp(qA, alpha),
      );

      // Calculate the angle offset from the parent branch and the radial angle
      const radialAngle = 2.0 * Math.PI * (radialOffset + i / this.options.leaves.count);
      const q1 = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0),
        this.options.leaves.angle / (180 / Math.PI),
      );
      const q2 = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        radialAngle,
      );
      const q3 = new THREE.Quaternion().setFromEuler(parentOrientation);

      const leafOrientation = new THREE.Euler().setFromQuaternion(
        q3.multiply(q2.multiply(q1)),
      );

      this.generateLeaf(leafOrigin, leafOrientation);
    }
  }

  /**
  * Generates a leaves
  * @param {THREE.Vector3} origin The starting point of the branch
  * @param {THREE.Euler} orientation The starting orientation of the branch
  */
  generateLeaf(origin, orientation) {
    let i = this.leaves.verts.length / 3;

    // Width and length of the leaf quad
    let leafSize =
      this.options.leaves.size *
      (1 +
        this.rng.random(
          this.options.leaves.sizeVariance,
          -this.options.leaves.sizeVariance,
        ));

    const W = leafSize;
    const L = leafSize;

    const createLeaf = (rotation) => {
      // Create quad vertices
      const v = [
        new THREE.Vector3(-W / 2, L, 0),
        new THREE.Vector3(-W / 2, 0, 0),
        new THREE.Vector3(W / 2, 0, 0),
        new THREE.Vector3(W / 2, L, 0),
      ].map((v) =>
        v
          .applyEuler(new THREE.Euler(0, rotation, 0))
          .applyEuler(orientation)
          .add(origin),
      );

      this.leaves.verts.push(
        v[0].x,
        v[0].y,
        v[0].z,
        v[1].x,
        v[1].y,
        v[1].z,
        v[2].x,
        v[2].y,
        v[2].z,
        v[3].x,
        v[3].y,
        v[3].z,
      );

      const n = new THREE.Vector3(0, 0, 1).applyEuler(orientation);
      this.leaves.normals.push(
        n.x,
        n.y,
        n.z,
        n.x,
        n.y,
        n.z,
        n.x,
        n.y,
        n.z,
        n.x,
        n.y,
        n.z,
      );
      this.leaves.uvs.push(0, 1, 0, 0, 1, 0, 1, 1);
      this.leaves.indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
      i += 4;
    };

    createLeaf(0);
    if (this.options.leaves.billboard === Billboard.Double) {
      createLeaf(Math.PI / 2);
    }
  }

  /**
   * Generates the indices for branch geometry
   * @param {Branch} branch
   */
  generateBranchIndices(indexOffset, branch) {
    // Build geometry each section of the branch (cylinder without end caps)
    let v1, v2, v3, v4;
    const N = branch.segmentCount + 1;
    for (let i = 0; i < branch.sectionCount; i++) {
      // Build the quad for each segment of the section
      for (let j = 0; j < branch.segmentCount; j++) {
        v1 = indexOffset + i * N + j;
        // The last segment wraps around back to the starting segment, so omit j + 1 term
        v2 = indexOffset + i * N + (j + 1);
        v3 = v1 + N;
        v4 = v2 + N;
        this.branches.indices.push(v1, v3, v2, v2, v3, v4);
        this.branches.levels.push(branch.level, branch.level);
      }
    }
  }

  /**
   * Generates the geometry for the branches
   */
  createBranchesGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(this.branches.verts), 3),
    );
    g.setAttribute(
      'normal',
      new THREE.BufferAttribute(new Float32Array(this.branches.normals), 3),
    );
    g.setAttribute(
      'uv',
      new THREE.BufferAttribute(new Float32Array(this.branches.uvs), 2),
    );
    g.setIndex(
      new THREE.BufferAttribute(new Uint16Array(this.branches.indices), 1),
    );
    g.userData.triangleLevels = Uint8Array.from(this.branches.levels);
    g.computeBoundingSphere();

    this.branchesMesh.geometry.dispose();
    this.branchesMesh.geometry = g;
  }

  /**
   * Generates the geometry for the leaves
   */
  createLeavesGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(this.leaves.verts), 3),
    );
    g.setAttribute(
      'uv',
      new THREE.BufferAttribute(new Float32Array(this.leaves.uvs), 2),
    );
    g.setIndex(
      new THREE.BufferAttribute(new Uint16Array(this.leaves.indices), 1),
    );
    g.computeVertexNormals();
    g.computeBoundingSphere();

    this.leavesMesh.geometry.dispose();
    this.leavesMesh.geometry = g;
  }

  /**
   * Find the nearest point on the trellis grid to a given position
   * @param {THREE.Vector3} position
   * @returns {THREE.Vector3}
   */
  getNearestTrellisPoint(position) {
    const t = this.options.trellis;
    const trellisX = t.position.x;
    const trellisY = t.position.y;
    const trellisZ = t.position.z;

    // Trellis bounds
    const minX = trellisX - t.width / 2;
    const maxX = trellisX + t.width / 2;
    const minY = trellisY;
    const maxY = trellisY + t.height;

    // Clamp position to trellis bounds for projection
    const clampedX = Math.max(minX, Math.min(maxX, position.x));
    const clampedY = Math.max(minY, Math.min(maxY, position.y));

    // Find nearest horizontal line (Y = constant)
    const nearestHLineY = Math.round((clampedY - minY) / t.spacing) * t.spacing + minY;
    const finalHLineY = Math.max(minY, Math.min(maxY, nearestHLineY));

    // Find nearest vertical line (X = constant)
    const nearestVLineX = Math.round((clampedX - minX) / t.spacing) * t.spacing + minX;
    const finalVLineX = Math.max(minX, Math.min(maxX, nearestVLineX));

    // Point on nearest horizontal line (X can vary along the line)
    const pointOnHLine = new THREE.Vector3(clampedX, finalHLineY, trellisZ);

    // Point on nearest vertical line (Y can vary along the line)
    const pointOnVLine = new THREE.Vector3(finalVLineX, clampedY, trellisZ);

    // Return whichever is closer
    const distH = position.distanceTo(pointOnHLine);
    const distV = position.distanceTo(pointOnVLine);

    return distH < distV ? pointOnHLine : pointOnVLine;
  }

  /**
   * Calculate the force vector toward the nearest trellis point
   * @param {THREE.Vector3} position Current section position
   * @param {number} radius Current section radius
   * @returns {{ direction: THREE.Vector3, strength: number } | null}
   */
  calculateTrellisForce(position, radius) {
    const trellis = this.options.trellis;
    const nearestPoint = this.getNearestTrellisPoint(position);

    const distance = position.distanceTo(nearestPoint);

    // Only apply force within max distance
    if (distance > trellis.force.maxDistance) return null;
    if (distance < 0.001) return null; // Avoid division by zero

    // Calculate direction toward trellis
    const direction = new THREE.Vector3()
      .subVectors(nearestPoint, position)
      .normalize();

    // Calculate strength with distance falloff
    // Closer = stronger force, scaled by inverse radius (like existing force)
    const distanceFactor = 1 - Math.pow(
      distance / trellis.force.maxDistance,
      trellis.force.falloff,
    );
    const strength = trellis.force.strength * distanceFactor / radius;

    return { direction, strength };
  }

  get vertexCount() {
    return (this.branches.verts.length + this.leaves.verts.length) / 3;
  }

  get triangleCount() {
    return (this.branches.indices.length + this.leaves.indices.length) / 3;
  }
}
