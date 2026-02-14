// Firebase Configuration
// IMPORTANT: Replace these values with your actual Firebase config

const firebaseConfig = {
    apiKey: "YOUR_API_KEY_HERE",
    authDomain: "lstv-annotation-tool.firebaseapp.com",
    projectId: "lstv-annotation-tool",
    storageBucket: "lstv-annotation-tool.appspot.com",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
};

// Initialize Firebase (will be used by other scripts)
firebase.initializeApp(firebaseConfig);

// Initialize services
const db = firebase.firestore();
const auth = firebase.auth();
const storage = firebase.storage();
const googleProvider = new firebase.auth.GoogleAuthProvider();
