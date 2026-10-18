import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

// Firebase's web configuration identifies a public project; it is not a service credential.
const app = initializeApp({
  apiKey: "AIzaSyCglybinO8OXesR4imHeKFdf9a1X02fpCI",
  authDomain: "parcelmate-a3fb2.firebaseapp.com",
  projectId: "parcelmate-a3fb2",
  storageBucket: "parcelmate-a3fb2.firebasestorage.app",
  messagingSenderId: "572979666425",
  appId: "1:572979666425:web:873396f17f98c19ca93128",
});

export const auth = getAuth(app);
