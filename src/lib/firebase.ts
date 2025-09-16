import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// Your web app's Firebase configuration
const firebaseConfig = {
  "projectId": "studio-3260003082-f9914",
  "appId": "1:585604854129:web:3e44e402729fea740586d0",
  "storageBucket": "studio-3260003082-f9914.firebasestorage.app",
  "apiKey": "AIzaSyAsWEpA2RrtzeetmilZIFo9VnOPqlo-BYE",
  "authDomain": "studio-3260003082-f9914.firebaseapp.com",
  "measurementId": "",
  "messagingSenderId": "585604854129"
};

// Initialize Firebase
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app, {
  ignoreUndefinedProperties: true,
});

export { db };