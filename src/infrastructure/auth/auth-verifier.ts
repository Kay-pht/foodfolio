import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

export interface VerifiedIdentity {
  firebaseUid: string;
}
export interface AuthVerifier {
  verifyIdToken(token: string): Promise<VerifiedIdentity>;
}
export interface FirebaseUserManager {
  deleteUser(firebaseUid: string): Promise<void>;
}

export class FirebaseAdminAuth implements AuthVerifier, FirebaseUserManager {
  constructor() {
    if (getApps().length === 0) initializeApp();
  }
  async verifyIdToken(token: string): Promise<VerifiedIdentity> {
    const decoded = await getAuth().verifyIdToken(token, true);
    return { firebaseUid: decoded.uid };
  }
  async deleteUser(firebaseUid: string): Promise<void> {
    await getAuth().deleteUser(firebaseUid);
  }
}
