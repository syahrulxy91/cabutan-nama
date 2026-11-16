import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';

const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
const app = initializeApp(isLocal ? { projectId: 'demo-cabutan-nama', apiKey: 'demo-key', authDomain: 'demo-cabutan-nama.firebaseapp.com' } : {
  apiKey: 'AIzaSyAyI3Qt-PN5XVxG1yIhfGXayTJp5O8uIjM',
  authDomain: 'cabutan-nama.firebaseapp.com',
  projectId: 'cabutan-nama',
  storageBucket: 'cabutan-nama.firebasestorage.app',
  messagingSenderId: '647007113305',
  appId: '1:647007113305:web:9a8fdfddf14ab8fec62148'
});
const auth = getAuth(app);
const functions = getFunctions(app, 'asia-southeast1');
if (isLocal) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}
const rpc = httpsCallable(functions, 'cabutNama');
const google = new GoogleAuthProvider();
google.setCustomParameters({ prompt: 'select_account' });
window.cabutFirebase = {
  observe: cb => onAuthStateChanged(auth, cb),
  signIn: () => signInWithPopup(auth, google),
  signOut: () => signOut(auth),
  call: async (action, data = {}) => (await rpc({ action, ...data })).data
};
