// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyBrYhf0kOBOouieiKZpjc0Nu5NN0qk8xI8",
  authDomain: "lstv-annotation-tool.firebaseapp.com",
  projectId: "lstv-annotation-tool",
  storageBucket: "lstv-annotation-tool.firebasestorage.app",
  messagingSenderId: "525812647843",
  appId: "1:525812647843:web:dd6fc8e55513fdca1a3c16"
};

// Initialize Firebase (will be used by other scripts)
firebase.initializeApp(firebaseConfig);

// Initialize services
const db = firebase.firestore();
const auth = firebase.auth();
const storage = firebase.storage();
const googleProvider = new firebase.auth.GoogleAuthProvider();
