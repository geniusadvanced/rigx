// src/app/auth/register.js
import { auth, db } from "../lib/firebaseClient";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";

export async function register(email, password) {
  const res = await createUserWithEmailAndPassword(auth, email, password);

  await setDoc(doc(db, "users", res.user.uid), {
    email: res.user.email,
    createdAt: Date.now(),
  });

  return res;
}
