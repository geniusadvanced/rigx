// src/app/auth/login.js
import { auth } from "../lib/firebaseClient";
import { signInWithEmailAndPassword } from "firebase/auth";

export async function login(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}
