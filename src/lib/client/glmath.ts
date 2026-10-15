/* Tiny column-major matrix helpers (WebGL convention). No dependencies. */
export type V3 = [number, number, number];
export type Q4 = [number, number, number, number];
export type Mat4 = Float32Array;

export const mat4 = {
  identity(): Mat4 { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; },
  multiply(a: Mat4, b: Mat4, out: Mat4 = new Float32Array(16)): Mat4 {
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
    }
    return out;
  },
  perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
    const f = 1 / Math.tan(fovY / 2), nf = 1 / (near - far);
    const m = new Float32Array(16);
    m[0] = f / aspect; m[5] = f; m[10] = (far + near) * nf; m[11] = -1; m[14] = 2 * far * near * nf;
    return m;
  },
  /** Rotation matrix (3x3, column-major) from a unit quaternion. */
  rotFromQuat(q: Q4): Float32Array {
    const [x, y, z, w] = q;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
    return new Float32Array([1 - (yy + zz), xy + wz, xz - wy, xy - wz, 1 - (xx + zz), yz + wx, xz + wy, yz - wx, 1 - (xx + yy)]);
  },
  /** World -> eye matrix for a camera at `pos` with orientation `q`. */
  viewFromPose(pos: V3, q: Q4): Mat4 {
    const R = mat4.rotFromQuat(q);              // camera -> world
    const m = new Float32Array(16);
    // transpose of R
    m[0] = R[0]; m[1] = R[3]; m[2] = R[6];
    m[4] = R[1]; m[5] = R[4]; m[6] = R[7];
    m[8] = R[2]; m[9] = R[5]; m[10] = R[8];
    m[12] = -(m[0] * pos[0] + m[4] * pos[1] + m[8] * pos[2]);
    m[13] = -(m[1] * pos[0] + m[5] * pos[1] + m[9] * pos[2]);
    m[14] = -(m[2] * pos[0] + m[6] * pos[1] + m[10] * pos[2]);
    m[15] = 1;
    return m;
  },
  /** Model matrix: uniform scale, rotation about Y by `yaw`, rotation about Z by `roll` first, then translation. */
  model(pos: V3, scale: number, yaw: number, roll = 0): Mat4 {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cr = Math.cos(roll), sr = Math.sin(roll);
    // R = Ry * Rz
    const m = new Float32Array(16);
    m[0] = cy * cr * scale; m[1] = sr * scale; m[2] = -sy * cr * scale;
    m[4] = -cy * sr * scale; m[5] = cr * scale; m[6] = sy * sr * scale;
    m[8] = sy * scale; m[9] = 0; m[10] = cy * scale;
    m[12] = pos[0]; m[13] = pos[1]; m[14] = pos[2]; m[15] = 1;
    return m;
  },
  rotY(yaw: number, roll = 0): Float32Array {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cr = Math.cos(roll), sr = Math.sin(roll);
    return new Float32Array([cy * cr, sr, -sy * cr, -cy * sr, cr, sy * sr, sy, 0, cy]);
  },
  transformPoint(m: Mat4, p: V3): [number, number, number, number] {
    return [
      m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
      m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
      m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
      m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15]
    ];
  }
};
