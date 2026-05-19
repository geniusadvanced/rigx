import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type UserCredential,
  type User,
} from 'firebase/auth';
import { auth } from './init';

export function observeAuthState(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, callback);
}

export function loginWithEmail(email: string, password: string): Promise<UserCredential> {
  return signInWithEmailAndPassword(auth, email, password);
}

export function logout(): Promise<void> {
  return signOut(auth);
}

export function getCurrentUser(): User | null {
  return auth.currentUser;
}

export const signIn = loginWithEmail;
export const signOutUser = logout;

export { auth };
