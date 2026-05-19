'use client';

/*
PINPOINT REPORT
- File: src/app/page.js
- Culprit variable: runFirestoreOp (with helper callbacks like logFirestoreEvent, logDeniedOp, etc.)
- First references: loadUserProfile/useEffect dependencies around lines ~315–390.
- Declaration (before fix) sat much later (~line 750), so hooks accessed it before initialization, causing a temporal dead zone ReferenceError.
- Root cause: declaration order inside RigX component; moving the helper block above all hooks eliminates the TDZ.
- Focus-loss culprit: Settings modal was declared inline (lines ~1330–1505) and rendered as <SettingsModal /> (line ~3333). Because the function was recreated every render, React treated it as a brand-new component each time, unmounting/remounting the modal on every keystroke and dropping input focus. Rendering it as a stable helper function keeps the DOM subtree mounted while typing.
- Profile-save culprit (cause C): runFirestoreOp tracks permission failures in a denylist. When users first opened Settings while still anonymous, the `WRITE:userProfile` opKey was marked denied, so later authenticated saves never even attempted the Firestore write—`runFirestoreOp` returned `undefined`, the handler treated it as success, and nothing persisted under `artifacts/${appId}/users/${uid}`. Fix: bypass the denylist for profile saves, add explicit logging, sanitize the payload, and surface hard errors when writes are blocked.
- Error-propagation culprit: runFirestoreOp (lines ~214–250) returned `undefined` for WRITE failures and sometimes threw plain objects, so callers logged `[PROFILE-SAVE-ERROR] {}` with zero context. Fix: WRITE skips now throw `Error('Firestore WRITE blocked: <opKey>')`, and catch blocks always rethrow Error instances. handleProfileSave (lines ~472–540) now bypasses runFirestoreOp entirely, logs every await, and only throws/handles real Error instances so profile saves can't fail silently.
*/

// PERM REPORT:
// - Denied opKey: READ:userProfile
// - Path: artifacts/${appId}/users/{uid}
// - Query: getDoc profile document
// - Auth: authReady true, uid (anonymous), isAnonymous true
// - Fix: skip profile/address/badge reads and writes for anonymous sessions.

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
// Import the functions you need from the SDKs you need
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAnalytics, isSupported } from "firebase/analytics";
import { 
  getAuth, 
  signInAnonymously, 
  signInWithCustomToken, 
  onAuthStateChanged, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signOut, 
  updateProfile,
  sendPasswordResetEmail, // FIX: forgot password
  updatePassword, // DATA-ONLY
  deleteUser // DATA-ONLY
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  addDoc, 
  getDocs, 
  doc, 
  updateDoc, 
  deleteDoc, 
  onSnapshot, 
  serverTimestamp, 
  query, 
  orderBy, 
  where,
  limit,
  getDoc,
  setDoc,
  runTransaction
} from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { 
  ShoppingCart, 
  Search, 
  Menu, 
  User, 
  Users,
  PlusCircle, 
  MessageSquare, 
  Home, 
  Cpu, 
  Monitor, 
  HardDrive, 
  Trash2, 
  Star, 
  Filter,
  X,
  LogOut,
  Zap,
  CheckCircle,
  Truck,
  Repeat, 
  Flame, 
  ArrowRightLeft,
  Droplets, 
  MessageCircleQuestion,
  Heart, 
  ThumbsUp,
  AlertTriangle,
  Upload,
  Package,
  DollarSign,
  TrendingUp,
  Send,
  Wrench,
  ChevronLeft,
  MapPin,
  ShieldCheck,
  Tag,
  StarHalf
} from 'lucide-react';

// --- Firebase Configuration ---
const firebaseConfig = {
  apiKey: "AIzaSyAZL93v6CPfWQWjEEz89CXBHLzdnGcnwy4",
  authDomain: "rigx-marketplace.firebaseapp.com",
  projectId: "rigx-marketplace",
  storageBucket: "rigx-marketplace.firebasestorage.app",
  messagingSenderId: "647947951244",
  appId: "1:647947951244:web:176d30fa1bdf0af42cafa9",
  measurementId: "G-7CVXGZN6SX"
};

// Initialize Firebase (Prevent multiple initializations)
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

const appId = typeof __app_id !== 'undefined' ? __app_id : 'rigmarket-app';
const FOUNDER_EMAIL = "asyrafrashidin@gmail.com"; // DATA-ONLY: badge

// --- Constants & Data Models ---
const CATEGORIES = [
  { id: 'gpu', name: 'Graphics Cards', icon: <Zap className="w-5 h-5"/> },
  { id: 'cpu', name: 'Processors', icon: <Cpu className="w-5 h-5"/> },
  { id: 'ram', name: 'RAM', icon: <HardDrive className="w-5 h-5"/> },
  { id: 'mobo', name: 'Motherboards', icon: <Cpu className="w-5 h-5"/> },
  { id: 'watercool', name: 'Custom Watercooling', icon: <Droplets className="w-5 h-5"/> }, 
  { id: 'storage', name: 'Storage', icon: <HardDrive className="w-5 h-5"/> },
  { id: 'psu', name: 'Power Supply', icon: <Zap className="w-5 h-5"/> },
  { id: 'case', name: 'Casing', icon: <Monitor className="w-5 h-5"/> },
  { id: 'prebuilt', name: 'Prebuilt PCs', icon: <Monitor className="w-5 h-5"/> },
  { id: 'laptop', name: 'Laptops', icon: <Monitor className="w-5 h-5"/> },
  { id: 'monitor', name: 'Monitors', icon: <Monitor className="w-5 h-5"/> },
  { id: 'peripheral', name: 'Peripherals', icon: <CheckCircle className="w-5 h-5"/> },
];

const COURIERS = ['PosLaju', 'J&T Express', 'GDEX', 'NinjaVan'];

const SPEC_FIELDS = {
  gpu: ['VRAM', 'Chipset', 'Length (mm)'],
  cpu: ['Socket', 'Cores/Threads', 'Base Clock'],
  ram: ['Type (DDR4/5)', 'Speed (MHz)', 'Capacity'],
  monitor: ['Resolution', 'Refresh Rate', 'Panel Type'],
  storage: ['Type (NVMe/SATA)', 'Capacity', 'Read Speed'],
  watercool: ['Radiator Size (mm)', 'Pump Type', 'Tubing Type', 'Fitting Size'], 
};
const MALAYSIAN_STATES = ['Johor','Kedah','Kelantan','Melaka','Negeri Sembilan','Pahang','Perak','Perlis','Pulau Pinang','Sabah','Sarawak','Selangor','Terengganu','Wilayah Persekutuan Kuala Lumpur','Wilayah Persekutuan Putrajaya','Wilayah Persekutuan Labuan']; // FIX: state filter
// ===== HOT BUMP START =====
const KL_DAY_FORMATTER = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }); // DATA-ONLY
const formatKLDayKey = (date = new Date()) => KL_DAY_FORMATTER.format(date); // DATA-ONLY
const parseDayKeyToMillis = (dayKey) => { // DATA-ONLY
  if (!dayKey) return null; // DATA-ONLY
  const parts = dayKey.split('-'); // DATA-ONLY
  if (parts.length !== 3) return null; // DATA-ONLY
  const [year, month, day] = parts.map((part) => Number(part)); // DATA-ONLY
  if (!year || !month || !day) return null; // DATA-ONLY
  return Date.UTC(year, month - 1, day); // DATA-ONLY
}; // DATA-ONLY
// ===== HOT BUMP END =====

// --- Helper Functions ---
const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(amount);
};

// --- Components ---

const Toast = ({ message, type, onClose }) => (
  <div className={`fixed top-4 right-4 z-[100] px-4 py-2 rounded shadow-lg animate-fade-in ${
    type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
  }`}>
    {message}
  </div>
);

// New Component: Star Rating Input/Display
const StarRating = ({ rating, setRating, readOnly = false, size = 16 }) => {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          disabled={readOnly}
          onClick={() => !readOnly && setRating(star)}
          className={`${readOnly ? 'cursor-default' : 'cursor-pointer hover:scale-110 transition-transform'}`}
        >
          <Star 
            size={size} 
            className={`${star <= rating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-600'}`} 
          />
        </button>
      ))}
    </div>
  );
};

// --- Main Application Component ---
export default function RigX() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState('home'); 
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState(''); // FIX: search input focus
  const [activeSearchField, setActiveSearchField] = useState(null); // FIX: search input focus
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [toast, setToast] = useState(null);
  const [showSwapOnly, setShowSwapOnly] = useState(false);
  const [selectedState, setSelectedState] = useState('all'); // FIX: state filter
  const [userBadge, setUserBadge] = useState(null); // DATA-ONLY: badge
  const [activeChat, setActiveChat] = useState(null);
  const [configError, setConfigError] = useState(false);
  
  // Review System State
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [reviewTarget, setReviewTarget] = useState(null); // { sellerId, itemId, itemTitle, orderId }

  // Support / Repair System State
  const [supportMenuOpen, setSupportMenuOpen] = useState(false);
  const [repairModalOpen, setRepairModalOpen] = useState(false);

  // Seller Dashboard State
  const [myListings, setMyListings] = useState([]);
  const [mySales] = useState([]);
  
  // New State for Recommendations
  const [favorites, setFavorites] = useState(new Set()); 
  const [recentSearches, setRecentSearches] = useState([]);
  const [hotItems, setHotItems] = useState([]); // DATA-ONLY
  const [hotLoading, setHotLoading] = useState(true); // DATA-ONLY
  const [hotPaused, setHotPaused] = useState(false); // UI-ONLY
  // ===== HOT BUMP START =====
  const [sellerHotBumpDayKey, setSellerHotBumpDayKey] = useState(''); // DATA-ONLY
  const [sellerHotBumpCount, setSellerHotBumpCount] = useState(0); // DATA-ONLY
  const [hotBumpLoadingId, setHotBumpLoadingId] = useState(null); // UI-ONLY
  // ===== HOT BUMP END =====
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false); // UI-ONLY
  const [selectedHighlightPlan, setSelectedHighlightPlan] = useState('RM10 / 2 Weeks'); // UI-ONLY
  const [authReady, setAuthReady] = useState(false); // FIX: permissions root cause
  const productsUnsubRef = useRef(null); // FIX: watch stream
  const isAnonymousUser = !!user?.isAnonymous; // FIX: permissions root cause
  const hasAuthUser = authReady && !!user?.uid;
  const hasFullUser = hasAuthUser && !isAnonymousUser;
  const permissionLogRef = useRef(new Set()); // FIX: permissions
  const deniedOpsRef = useRef(new Set()); // FIX: permissions
  const firestoreEventLogRef = useRef(new Set()); // FIX: firestore instrumentation
  const ensuredProfileDocRef = useRef(new Set()); // DATA-ONLY

  // Draggable FAB State
  const [fabPos, setFabPos] = useState({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const initialFabPosRef = useRef({ x: 0, y: 0 });
  const hotScrollTimeoutRef = useRef(null); // UI-ONLY
  const desktopSearchRef = useRef(null); // FIX: search input focus
  const mobileSearchRef = useRef(null); // FIX: search input focus

  const showToast = useCallback((msg, type = 'success') => {
    setToast({ message: msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const logFirestoreEvent = useCallback((stage, opKey, meta = {}) => { // FIX: firestore instrumentation
    const key = `${stage}:${opKey}`; // FIX: firestore instrumentation
    if (firestoreEventLogRef.current.has(key)) return; // FIX: firestore instrumentation
    firestoreEventLogRef.current.add(key); // FIX: firestore instrumentation
    console.info(`[FS-${stage}] ${opKey}`, { // FIX: firestore instrumentation
      ...meta, // FIX: firestore instrumentation
      auth: { // FIX: firestore instrumentation
        ready: authReady, // FIX: firestore instrumentation
        uid: user?.uid || null, // FIX: firestore instrumentation
        anonymous: !!user?.isAnonymous, // FIX: firestore instrumentation
      }, // FIX: firestore instrumentation
      timestamp: new Date().toISOString(), // FIX: firestore instrumentation
    }); // FIX: firestore instrumentation
  }, [authReady, user]); // FIX: firestore instrumentation

  const logDeniedOp = useCallback((opKey, meta) => { // FIX: permissions
    if (permissionLogRef.current.has(opKey)) return; // FIX: permissions
    permissionLogRef.current.add(opKey); // FIX: permissions
    console.warn('[PERM-DIAG]', opKey, {
      ...meta,
      auth: {
        ready: authReady,
        uid: user?.uid || null,
        email: user?.email || null,
        anonymous: !!user?.isAnonymous,
      }
    }); // FIX: permissions
  }, [authReady, user]); // FIX: permissions

  const isInternalFirestoreError = useCallback((error) => { // FIX: firestore instrumentation
    if (!error) return false; // FIX: firestore instrumentation
    const message = error.message || ''; // FIX: firestore instrumentation
    return ( // FIX: firestore instrumentation
      message.includes('INTERNAL ASSERTION FAILED') || // FIX: firestore instrumentation
      message.includes('Unexpected state') || // FIX: firestore instrumentation
      error.code === 'internal' // FIX: firestore instrumentation
    ); // FIX: firestore instrumentation
  }, []); // FIX: firestore instrumentation

  const blockFirestoreOp = useCallback((opKey, reason, meta = {}) => { // FIX: firestore instrumentation
    if (deniedOpsRef.current.has(opKey)) return; // FIX: firestore instrumentation
    deniedOpsRef.current.add(opKey); // FIX: firestore instrumentation
    logFirestoreEvent('DISABLED', opKey, { reason, ...meta }); // FIX: firestore instrumentation
  }, [logFirestoreEvent]); // FIX: firestore instrumentation

  const markDeniedOp = useCallback((opKey, meta) => { // FIX: permissions
    if (!deniedOpsRef.current.has(opKey)) { // FIX: permissions
      deniedOpsRef.current.add(opKey); // FIX: permissions
      logDeniedOp(opKey, meta); // FIX: permissions
    }
  }, [logDeniedOp]); // FIX: permissions

  const safeStr = (value) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Error) {
      return `${value.name || 'Error'}: ${value.message || 'Unknown error'}`;
    }
    try {
      const seen = new WeakSet();
      return JSON.stringify(value, (_, val) => {
        if (typeof val === 'object' && val !== null) {
          if (seen.has(val)) return '[Circular]';
          seen.add(val);
        }
        return val;
      });
    } catch {
      try { return String(value); } catch { return '[unserializable]'; }
    }
  };

  const logListenerEvent = useCallback((listenerId, phase = 'UNKNOWN', meta = {}, isError = false) => {
    try {
      const normalizedMeta = { ...(meta || {}) };
      const rawError = normalizedMeta.rawError;
      if (rawError && typeof rawError === 'object') {
        normalizedMeta.code = normalizedMeta.code ?? rawError.code;
        normalizedMeta.message = normalizedMeta.message ?? rawError.message;
        normalizedMeta.stack = normalizedMeta.stack ?? rawError.stack;
        normalizedMeta.name = normalizedMeta.name ?? rawError.name ?? rawError.constructor?.name;
      }
      const safePhase = (typeof phase === 'string' && phase.toUpperCase() === 'UNSUBSCRIBE') ? 'CLEANUP/UNSUB' : phase;
      const payload = {};
      const assignField = (key, value) => {
        const safeValue = safeStr(value);
        if (safeValue !== undefined) {
          payload[key] = safeValue;
        }
      };
      assignField('path', normalizedMeta.path);
      assignField('query', normalizedMeta.query);
      assignField('code', normalizedMeta.code);
      assignField('name', normalizedMeta.name);
      assignField('message', normalizedMeta.message);
      assignField('stack', normalizedMeta.stack);
      assignField('reason', normalizedMeta.reason);
      assignField('uid', user?.uid);
      assignField('appId', appId);
      assignField('authReady', authReady);
      assignField('isAnon', user?.isAnonymous);

      const isCleanupPhase = typeof safePhase === 'string' && /UNSUBSCRIBE|CLEANUP/i.test(safePhase);
      const logger = (isError && !isCleanupPhase) ? console.error : console.info;
      const finalPayload = Object.keys(payload).length ? payload : { note: 'No listener metadata provided' };

      logger(`[FS-LISTEN][${listenerId}] ${safePhase}`, finalPayload);
      if (rawError) {
        console.error(`[FS-LISTEN][${listenerId}] ${safePhase}:RAW`, rawError);
      }
    } catch (logError) {
      console.error(`[FS-LISTEN][${listenerId}] LOG_FAILURE`, { message: logError?.message || 'Failed to log listener event' });
      if (meta?.rawError) {
        console.error(`[FS-LISTEN][${listenerId}] RAW_FALLBACK`, meta.rawError);
      }
    }
  }, [user?.uid, user?.isAnonymous, appId, authReady]);

  const runFirestoreOp = useCallback(async (opKey, type, path, queryDesc, fn) => { // FIX: permissions
    console.warn('[FS-OP-ENTER]', { opKey, type, path }); // FIX: permissions
    const fallbackValue = (type === 'READ' || type === 'LISTEN') ? null : undefined; // FIX: permissions
    const buildWriteError = (reason) => new Error(`Firestore WRITE blocked: ${opKey}${reason ? ` (${reason})` : ''}`); // FIX: permissions
    const normalizeError = (err, fallbackMsg) => (err instanceof Error ? err : new Error(fallbackMsg)); // FIX: permissions
    if (deniedOpsRef.current.has(opKey)) { // FIX: permissions
      logDeniedOp(opKey, { type, path, query: queryDesc, skipped: true }); // FIX: permissions
      console.warn('[FS-OP-BLOCKED]', { opKey, type, path, reason: 'denylist' }); // FIX: permissions
      if (type === 'WRITE') { // FIX: permissions
        throw buildWriteError('denylist'); // FIX: permissions
      }
      return fallbackValue; // FIX: permissions
    }
    logFirestoreEvent('START', opKey, { type, path, query: queryDesc }); // FIX: firestore instrumentation
    try {
      const result = await fn();
      logFirestoreEvent('SUCCESS', opKey, { type, path }); // FIX: firestore instrumentation
      return result;
    } catch (error) {
      if (isInternalFirestoreError(error)) { // FIX: firestore instrumentation
        logFirestoreEvent('INTERNAL', opKey, { type, path, message: error?.message }); // FIX: firestore instrumentation
        blockFirestoreOp(opKey, 'internal-error', { path, query: queryDesc }); // FIX: firestore instrumentation
        console.warn('[FS-OP-THROW]', { opKey, type, reason: 'internal-error', message: error?.message }); // FIX: permissions
        if (type === 'WRITE') { // FIX: permissions
          throw buildWriteError('internal-error'); // FIX: permissions
        }
        return fallbackValue; // FIX: firestore instrumentation
      }
      if (error?.code === 'permission-denied') {
        markDeniedOp(opKey, { type, path, query: queryDesc }); // FIX: permissions
        console.warn('[FS-OP-THROW]', { opKey, type, reason: 'permission-denied' }); // FIX: permissions
        if (type === 'WRITE') { // FIX: permissions
          throw buildWriteError('permission-denied'); // FIX: permissions
        }
        return fallbackValue; // FIX: permissions
      }
      logFirestoreEvent('ERROR', opKey, { type, path, message: error?.message }); // FIX: firestore instrumentation
      console.warn('[FS-OP-THROW]', { opKey, type, reason: 'error', message: error?.message }); // FIX: permissions
      if (type === 'WRITE') { // FIX: permissions
        throw normalizeError(error, `Firestore WRITE failed: ${opKey}`); // FIX: permissions
      }
      throw normalizeError(error, `Firestore operation failed: ${opKey}`); // FIX: permissions
    }
  }, [logDeniedOp, markDeniedOp, logFirestoreEvent, isInternalFirestoreError, blockFirestoreOp]); // FIX: permissions

  useEffect(() => { // DATA-ONLY
    if (!authReady || !user?.uid || !db || user.isAnonymous) return; // DATA-ONLY
    const key = `${appId}:${user.uid}`; // DATA-ONLY
    if (ensuredProfileDocRef.current.has(key)) return; // DATA-ONLY
    const traceId = `PROFILE-ENSURE-${Date.now()}-${Math.random().toString(16).slice(2)}`; // DATA-ONLY
    const path = `artifacts/${appId}/users/${user.uid}`; // DATA-ONLY
    const payload = { uid: user.uid, appId, updatedAt: serverTimestamp() }; // DATA-ONLY
    ensuredProfileDocRef.current.add(key); // DATA-ONLY
    console.info(`[PROFILE_WRITE][${traceId}] ENSURE_BEFORE`, { path, keys: Object.keys(payload) }); // DATA-ONLY
    const profileRef = doc(db, 'artifacts', appId, 'users', user.uid); // DATA-ONLY
    setDoc(profileRef, payload, { merge: true }) // DATA-ONLY
      .then(() => { // DATA-ONLY
        console.info(`[PROFILE_WRITE][${traceId}] ENSURE_AFTER`, { path }); // DATA-ONLY
      }) // DATA-ONLY
      .catch((error) => { // DATA-ONLY
        ensuredProfileDocRef.current.delete(key); // DATA-ONLY
        const normalizedError = error instanceof Error ? error : new Error(typeof error === 'string' ? error : (() => { try { return JSON.stringify(error); } catch { return String(error); } })()); // DATA-ONLY
        const rawCode = (error && typeof error === 'object' && 'code' in error) ? String(error.code || 'N/A') : String(normalizedError?.code || 'N/A'); // DATA-ONLY
        const meta = { traceId, path, message: String(normalizedError.message || 'Unknown error'), name: String(normalizedError.name || 'Error'), stack: String(normalizedError.stack || 'N/A'), code: rawCode }; // DATA-ONLY
        console.error('[PROFILE_WRITE-ERROR]', meta); // DATA-ONLY
        console.error('[PROFILE_WRITE-ERROR:raw]', error); // DATA-ONLY
      }); // DATA-ONLY
  }, [authReady, user?.uid, user?.isAnonymous, db, appId]); // DATA-ONLY

  // ===== PROFILE SETTINGS START =====
  const initialProfileForm = { // DATA-ONLY
    displayName: '', // DATA-ONLY
    phone: '', // DATA-ONLY
    bio: '', // DATA-ONLY
    photoURL: '', // DATA-ONLY
    isDeactivated: false, // DATA-ONLY
  }; // DATA-ONLY
  const initialAddressForm = { // DATA-ONLY
    label: 'Home', // DATA-ONLY
    recipientName: '', // DATA-ONLY
    phone: '', // DATA-ONLY
    line1: '', // DATA-ONLY
    line2: '', // DATA-ONLY
    city: '', // DATA-ONLY
    state: MALAYSIAN_STATES[0], // DATA-ONLY
    postcode: '', // DATA-ONLY
    isDefault: false, // DATA-ONLY
  }; // DATA-ONLY
  const [settingsOpen, setSettingsOpen] = useState(false); // UI-ONLY
  const [settingsTab, setSettingsTab] = useState('profile'); // UI-ONLY
  const [profileForm, setProfileForm] = useState(initialProfileForm); // DATA-ONLY
  const [profileLoading, setProfileLoading] = useState(false); // UI-ONLY
  const [profileSaving, setProfileSaving] = useState(false); // UI-ONLY
  const [avatarUploading, setAvatarUploading] = useState(false); // UI-ONLY
  const [addresses, setAddresses] = useState([]); // DATA-ONLY
  const [addressesLoading, setAddressesLoading] = useState(false); // UI-ONLY
  const [addressForm, setAddressForm] = useState(initialAddressForm); // DATA-ONLY
  const [addressSaving, setAddressSaving] = useState(false); // UI-ONLY
  const [addressError, setAddressError] = useState(null); // UI-ONLY
  const [editingAddressId, setEditingAddressId] = useState(null); // UI-ONLY
  const [newPassword, setNewPassword] = useState(''); // UI-ONLY
  const [confirmNewPassword, setConfirmNewPassword] = useState(''); // UI-ONLY
  const [passwordFeedback, setPasswordFeedback] = useState(null); // UI-ONLY
  const [passwordProcessing, setPasswordProcessing] = useState(false); // UI-ONLY
  const [privacyFeedback, setPrivacyFeedback] = useState(null); // UI-ONLY
  const [privacyProcessing, setPrivacyProcessing] = useState(false); // UI-ONLY
  const [deleteConfirm, setDeleteConfirm] = useState(''); // UI-ONLY
  const [deleteFeedback, setDeleteFeedback] = useState(null); // UI-ONLY
  const SETTINGS_TABS = useMemo(() => ([ // UI-ONLY
    { id: 'profile', label: 'Profile' }, // UI-ONLY
    { id: 'payment', label: 'Payment' }, // UI-ONLY
    { id: 'addresses', label: 'Addresses' }, // UI-ONLY
    { id: 'privacy', label: 'Privacy' }, // UI-ONLY
    { id: 'about', label: 'About' }, // UI-ONLY
  ]), []); // UI-ONLY

  const loadUserProfile = useCallback(async (options = {}) => { // DATA-ONLY
    const { traceId: providedTraceId, source = 'default' } = options || {}; // DATA-ONLY
    const traceId = providedTraceId || `PROFILE-READ-${Date.now()}-${Math.random().toString(16).slice(2)}`; // DATA-ONLY
    const op = 'PROFILE_READ'; // DATA-ONLY
    const path = user?.uid ? `artifacts/${appId}/users/${user.uid}` : 'N/A'; // DATA-ONLY
    console.info(`[${op}][${traceId}] ENTER`, { path, source, authReady, uid: user?.uid || null, anonymous: !!user?.isAnonymous }); // DATA-ONLY
    if (!hasFullUser || !db) { // DATA-ONLY
      console.warn(`[${op}][${traceId}] EARLY_RETURN`, { reason: 'auth', path }); // DATA-ONLY
      setProfileForm((prev) => ({ ...initialProfileForm, displayName: user?.displayName || '' })); // DATA-ONLY
      return; // DATA-ONLY
    }
    setProfileLoading(true); // UI-ONLY
    try {
      const profileRef = doc(db, 'artifacts', appId, 'users', user.uid); // DATA-ONLY
      console.info(`[${op}][${traceId}] BEFORE`, { path }); // DATA-ONLY
      const snap = await runFirestoreOp('READ:userProfile', 'READ', path, 'getDoc profile', () => getDoc(profileRef)); // DATA-ONLY
      if (!snap) {
        console.warn(`[${op}][${traceId}] NULL_SNAPSHOT`, { path }); // DATA-ONLY
        setProfileForm((prev) => ({ ...initialProfileForm, displayName: user.displayName || '' })); // DATA-ONLY
        return;
      }
      const exists = typeof snap.exists === 'function' ? snap.exists() : false; // DATA-ONLY
      console.info(`[${op}][${traceId}] AFTER`, { path, exists }); // DATA-ONLY
      if (exists) {
        const data = snap.data(); // DATA-ONLY
        setProfileForm((prev) => ({ // DATA-ONLY
          ...prev,
          displayName: data.displayName || user.displayName || '',
          phone: data.phone || '',
          bio: data.bio || '',
          photoURL: data.photoURL || '',
          isDeactivated: !!data.isDeactivated,
        }));
      } else {
        setProfileForm((prev) => ({ // DATA-ONLY
          ...prev,
          displayName: user.displayName || '',
        }));
      }
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(typeof error === 'string' ? error : (() => { try { return JSON.stringify(error); } catch { return String(error); } })()); // DATA-ONLY
      const rawCode = (error && typeof error === 'object' && 'code' in error) ? String(error.code || 'N/A') : String(normalizedError?.code || 'N/A'); // DATA-ONLY
      const meta = { traceId, path, message: String(normalizedError.message || 'Unknown error'), name: String(normalizedError.name || 'Error'), stack: String(normalizedError.stack || 'N/A'), code: rawCode }; // DATA-ONLY
      console.error(`[${op}-ERROR]`, meta); // DATA-ONLY
      console.error(`[${op}-ERROR:raw]`, error); // DATA-ONLY
    } finally {
      setProfileLoading(false); // UI-ONLY
      console.info(`[${op}][${traceId}] FINALLY`, { path }); // DATA-ONLY
    }
  }, [db, user, appId, authReady, hasFullUser]); // DATA-ONLY

  const fetchAddresses = useCallback(async () => { // DATA-ONLY
    if (!hasFullUser || !db) { setAddresses([]); return; } // DATA-ONLY
    setAddressesLoading(true); // UI-ONLY
    try {
      const addrRef = collection(db, 'artifacts', appId, 'users', user.uid, 'addresses'); // DATA-ONLY
      const snapshot = await runFirestoreOp('READ:userAddresses', 'READ', `artifacts/${appId}/users/${user.uid}/addresses`, 'getDocs addresses', () => getDocs(addrRef)); // DATA-ONLY
      if (!snapshot) { setAddresses([]); return; }
      const list = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })); // DATA-ONLY
      list.sort((a, b) => (b.isDefault === true) - (a.isDefault === true)); // UI-ONLY
      setAddresses(list); // DATA-ONLY
    } catch (error) {
      console.error('Address fetch error', error); // DATA-ONLY
    } finally {
      setAddressesLoading(false); // UI-ONLY
    }
  }, [db, user?.uid, appId, hasFullUser]); // DATA-ONLY

  useEffect(() => { // DATA-ONLY
    if (!hasFullUser || !db) {
      setProfileForm((prev) => ({ ...initialProfileForm, displayName: user?.displayName || '' }));
      setAddresses([]);
      return;
    }
    loadUserProfile();
    fetchAddresses();
  }, [hasFullUser, db, loadUserProfile, fetchAddresses, user?.displayName]); // DATA-ONLY

  useEffect(() => { // ===== HOT BUMP START ===== // DATA-ONLY
    if (!hasFullUser || !db) {
      setSellerHotBumpCount(0);
      setSellerHotBumpDayKey('');
      return;
    }
    const dayKey = formatKLDayKey();
    setSellerHotBumpDayKey(dayKey);
    const loadCounter = async () => {
      const counterRef = doc(db, 'artifacts', appId, 'users', user.uid, 'hotBumps', dayKey);
      const snap = await runFirestoreOp('READ:hotBumpCounter', 'READ', `artifacts/${appId}/users/${user.uid}/hotBumps/${dayKey}`, 'getDoc bump counter', () => getDoc(counterRef));
      if (snap && snap.exists()) {
        setSellerHotBumpCount(snap.data().count || 0);
      } else {
        setSellerHotBumpCount(0);
      }
    };
    loadCounter();
  }, [hasFullUser, db, appId, runFirestoreOp, user?.uid]); // ===== HOT BUMP END ===== // DATA-ONLY

  useEffect(() => { // UI-ONLY
    if (!user && settingsOpen) {
      setSettingsOpen(false);
    }
  }, [user, settingsOpen]); // UI-ONLY

  const handleProfileSave = useCallback(async () => { // DATA-ONLY // FIX: profile save
    const traceId = `PS-${Date.now()}-${Math.random().toString(16).slice(2)}`; // DATA-ONLY
    const entryMeta = { uid: user?.uid || null, isAnonymous: !!user?.isAnonymous, authReady, traceId }; // DATA-ONLY
    console.info(`[PROFILE-SAVE][${traceId}] ENTER`, entryMeta); // DATA-ONLY
    if (!authReady || !user?.uid || !db) { // DATA-ONLY
      console.warn(`[PROFILE-SAVE][${traceId}] EARLY-RETURN`, { reason: 'auth', ...entryMeta }); // DATA-ONLY
      showToast('Sign in to manage your profile', 'error'); // UI-ONLY
      return;
    }
    if (user.isAnonymous) {
      console.warn(`[PROFILE-SAVE][${traceId}] EARLY-RETURN`, { reason: 'anonymous-session', ...entryMeta });
      showToast('Sign in to manage your profile', 'error');
      return;
    }
    const profilePath = `artifacts/${appId}/users/${user.uid}`;
    const sanitize = (value = '') => (typeof value === 'string' ? value.trim() : value || '');
    const payload = {
      uid: user.uid,
      appId,
      displayName: sanitize(profileForm.displayName),
      phone: sanitize(profileForm.phone),
      bio: sanitize(profileForm.bio),
      photoURL: sanitize(profileForm.photoURL),
      isDeactivated: !!profileForm.isDeactivated,
      updatedAt: serverTimestamp(),
    };
    console.info(`[PROFILE-SAVE][${traceId}] PAYLOAD`, {
      path: profilePath,
      keys: Object.keys(payload),
      valueTypes: Object.entries(payload).reduce((acc, [key, value]) => {
        acc[key] = value === null ? 'null' : typeof value;
        return acc;
      }, {}),
    });
    console.info(`[PROFILE-SAVE][${traceId}] BEFORE`, { step: 'setDoc:artifacts/${appId}/users/${user.uid}', path: profilePath });
    setProfileSaving(true); // UI-ONLY
    try {
      const profileRef = doc(db, 'artifacts', appId, 'users', user.uid);
      await setDoc(profileRef, payload, { merge: true });
      console.info(`[PROFILE-SAVE][${traceId}] AFTER`, { step: 'setDoc', path: profilePath });
      if (payload.displayName && payload.displayName !== (user.displayName || '')) {
        console.info(`[PROFILE-SAVE][${traceId}] BEFORE`, { step: 'updateProfile' });
        await updateProfile(user, { displayName: payload.displayName });
        console.info(`[PROFILE-SAVE][${traceId}] AFTER`, { step: 'updateProfile' });
      }
      console.info(`[PROFILE-SAVE][${traceId}] BEFORE`, { step: 'loadUserProfile' });
      await loadUserProfile({ traceId, source: 'post-save' });
      console.info(`[PROFILE-SAVE][${traceId}] AFTER`, { step: 'loadUserProfile' });
      console.info(`[PROFILE-SAVE][${traceId}] SUCCESS`, { path: profilePath });
      showToast('Profile updated');
    } catch (caughtError) {
      const normalizedError = caughtError instanceof Error
        ? caughtError
        : new Error(typeof caughtError === 'string'
            ? caughtError
            : (() => { try { return JSON.stringify(caughtError); } catch { return String(caughtError); } })());
      const rawCode = (caughtError && typeof caughtError === 'object' && 'code' in caughtError)
        ? String(caughtError.code || 'N/A')
        : String(normalizedError?.code || 'N/A');
      const meta = {
        traceId,
        path: String(profilePath || 'N/A'),
        message: String(normalizedError.message || 'Unknown error'),
        name: String(normalizedError.name || 'Error'),
        stack: String(normalizedError.stack || 'N/A'),
        code: rawCode,
      };
      console.error('[PROFILE-SAVE-ERROR]', meta);
      console.error('[PROFILE-SAVE-ERROR:raw]', caughtError);
      if (rawCode === 'auth/requires-recent-login') {
        showToast('Please re-login to change your profile.', 'error');
      } else {
        showToast(`Unable to update profile: ${meta.message}`, 'error');
      }
    } finally {
      setProfileSaving(false);
      console.info(`[PROFILE-SAVE][${traceId}] FINALLY`, { path: profilePath });
    }
  }, [authReady, db, user, profileForm, appId, loadUserProfile, showToast]); // DATA-ONLY // FIX: profile save

  /*
  PROFILE SAVE DIAGNOSTIC GUIDE:
  1) Reproduce: open Account Settings → Profile, change a field, click Save.
  2) Console logs with “[PROFILE-SAVE][PS-*]” show each attempt. EARLY-RETURN indicates auth gating. BEFORE/AFTER pairs show which async step is running; failures leave a BEFORE without a matching AFTER.
  3) Error meta.code meanings:
     - permission-denied / unauthenticated: Firestore rules/auth issue.
     - auth/requires-recent-login: call updateProfile needs re-login.
     - invalid-argument / not-found: payload/path issue.
     - network/offline: meta.message reveals connectivity failures.
  */

  const handleAvatarUpload = useCallback(async (file) => { // DATA-ONLY
    if (!file || !hasFullUser || !storage || !db) {
      showToast('Sign in to update your avatar', 'error');
      return;
    }
    setAvatarUploading(true); // UI-ONLY
    try {
      const avatarRef = ref(storage, `users/${user.uid}/avatar`); // DATA-ONLY
      await uploadBytes(avatarRef, file); // DATA-ONLY
      const url = await getDownloadURL(avatarRef); // DATA-ONLY
      setProfileForm((prev) => ({ ...prev, photoURL: url })); // DATA-ONLY
      const profileRef = doc(db, 'artifacts', appId, 'users', user.uid); // DATA-ONLY
      await setDoc(profileRef, { uid: user.uid, appId, photoURL: url, updatedAt: serverTimestamp() }, { merge: true }); // DATA-ONLY
      await updateProfile(user, { photoURL: url }); // DATA-ONLY
      showToast('Avatar updated'); // UI-ONLY
    } catch (error) {
      console.error('Avatar upload failed', error);
      showToast('Avatar upload failed', 'error'); // UI-ONLY
    } finally {
      setAvatarUploading(false); // UI-ONLY
    }
  }, [user, storage, db, appId, showToast, hasFullUser]); // DATA-ONLY

  const startEditingAddress = (address) => { // UI-ONLY
    setEditingAddressId(address?.id || null); // UI-ONLY
    setAddressForm({
      label: address?.label || 'Home',
      recipientName: address?.recipientName || '',
      phone: address?.phone || '',
      line1: address?.line1 || '',
      line2: address?.line2 || '',
      city: address?.city || '',
      state: address?.state || MALAYSIAN_STATES[0],
      postcode: address?.postcode || '',
      isDefault: !!address?.isDefault,
    });
  };

  const resetAddressForm = () => { // UI-ONLY
    setAddressForm(initialAddressForm);
    setEditingAddressId(null);
    setAddressError(null);
  };

  const handleAddressSave = async () => { // DATA-ONLY
    if (!hasFullUser || !db) {
      showToast('Sign in to manage addresses', 'error');
      return;
    }
    if (!addressForm.recipientName || !addressForm.phone || !addressForm.line1 || !addressForm.city || !addressForm.state || !addressForm.postcode) {
      setAddressError('All required fields must be filled.'); // UI-ONLY
      return;
    }
    setAddressSaving(true); // UI-ONLY
    setAddressError(null); // UI-ONLY
    try {
      const addrRef = collection(db, 'artifacts', appId, 'users', user.uid, 'addresses'); // DATA-ONLY
      const payload = {
        ...addressForm,
        updatedAt: serverTimestamp(),
      };
      let targetId = editingAddressId || null; // DATA-ONLY
      if (editingAddressId) {
        await setDoc(doc(addrRef, editingAddressId), payload, { merge: true }); // DATA-ONLY
      } else {
        payload.createdAt = serverTimestamp(); // DATA-ONLY
        const newDoc = await addDoc(addrRef, payload); // DATA-ONLY
        targetId = newDoc.id; // DATA-ONLY
      }
      if (addressForm.isDefault && targetId) {
        const snapshot = await getDocs(addrRef); // DATA-ONLY
        await Promise.all(snapshot.docs.map((docSnap) => updateDoc(docSnap.ref, { isDefault: docSnap.id === targetId }))); // DATA-ONLY
      }
      showToast(`Address ${editingAddressId ? 'updated' : 'added'}`); // UI-ONLY
      resetAddressForm();
      fetchAddresses();
    } catch (error) {
      console.error('Address save error', error);
      setAddressError('Unable to save address.'); // UI-ONLY
    } finally {
      setAddressSaving(false); // UI-ONLY
    }
  };

  const handleAddressDelete = async (addressId) => { // DATA-ONLY
    if (!hasFullUser || !db || !addressId) {
      showToast('Sign in to manage addresses', 'error');
      return;
    }
    try {
      const addrRef = doc(db, 'artifacts', appId, 'users', user.uid, 'addresses', addressId); // DATA-ONLY
      await deleteDoc(addrRef); // DATA-ONLY
      showToast('Address removed'); // UI-ONLY
      fetchAddresses();
    } catch (error) {
      console.error('Address delete error', error);
      showToast('Unable to delete address', 'error'); // UI-ONLY
    }
  };

  const handleSetDefaultAddress = async (addressId) => { // DATA-ONLY
    if (!hasFullUser || !db || !addressId) {
      showToast('Sign in to manage addresses', 'error');
      return;
    }
    try {
      const addrCol = collection(db, 'artifacts', appId, 'users', user.uid, 'addresses'); // DATA-ONLY
      const snapshot = await getDocs(addrCol); // DATA-ONLY
      await Promise.all(snapshot.docs.map((docSnap) => updateDoc(docSnap.ref, { isDefault: docSnap.id === addressId }))); // DATA-ONLY
      showToast('Default address updated'); // UI-ONLY
      fetchAddresses();
    } catch (error) {
      console.error('Set default error', error);
      showToast('Unable to update default address', 'error'); // UI-ONLY
    }
  };

  const handleHotBump = useCallback(async (item) => { // ===== HOT BUMP START ===== // DATA-ONLY
    if (!hasFullUser || !db) {
      showToast('Sign in to bump items', 'error');
      return;
    }
    if (!item?.id) {
      showToast('Invalid listing.', 'error');
      return;
    }
    if (item.sellerId && item.sellerId !== user.uid) {
      showToast('You can only bump your own listings.', 'error');
      return;
    }
    const dayKey = sellerHotBumpDayKey || formatKLDayKey();
    if (sellerHotBumpCount >= 2) {
      showToast('Daily bump limit reached (2/day).', 'error');
      return;
    }
    const alreadyBumpedToday = item.hotBumpDayKey === dayKey && item.hotBumpBy === user.uid;
    if (alreadyBumpedToday) {
      showToast('This item is already bumped today.', 'error');
      return;
    }
    setHotBumpLoadingId(item.id);
    try {
      const result = await runFirestoreOp('TRANSACTION:hotBump', 'WRITE', `artifacts/${appId}/users/${user.uid}/hotBumps/${dayKey}`, `bump product ${item.id}`, () => runTransaction(db, async (transaction) => {
        const counterRef = doc(db, 'artifacts', appId, 'users', user.uid, 'hotBumps', dayKey);
        const productRef = doc(db, 'artifacts', appId, 'public', 'data', 'products', item.id);
        const productSnap = await transaction.get(productRef);
        if (!productSnap.exists()) {
          throw new Error('PRODUCT_MISSING');
        }
        const productData = productSnap.data();
        if (productData.sellerId && productData.sellerId !== user.uid) {
          throw new Error('NOT_OWNER');
        }
        const counterSnap = await transaction.get(counterRef);
        const currentCount = counterSnap.exists() ? counterSnap.data().count || 0 : 0;
        if (currentCount >= 2) {
          throw new Error('HOT_BUMP_LIMIT');
        }
        transaction.set(counterRef, { count: currentCount + 1, updatedAt: serverTimestamp() }, { merge: true });
        transaction.update(productRef, {
          hotBumpAt: serverTimestamp(),
          hotBumpBy: user.uid,
          hotBumpDayKey: dayKey,
        });
        return currentCount + 1;
      }));
      if (typeof result === 'number') {
        setSellerHotBumpCount(result);
        setMyListings((prev) => prev.map((listing) => {
          if (listing.id !== item.id) return listing;
          return {
            ...listing,
            hotBumpBy: user.uid,
            hotBumpDayKey: dayKey,
            hotBumpAt: { seconds: Math.floor(Date.now() / 1000) },
          };
        }));
        showToast('Item bumped to Hot Item of the Week!');
      }
    } catch (error) {
      if (error?.message === 'HOT_BUMP_LIMIT') {
        showToast('Daily bump limit reached (2/day).', 'error');
      } else if (error?.message === 'NOT_OWNER') {
        showToast('You can only bump your own listings.', 'error');
      } else if (error?.message === 'PRODUCT_MISSING') {
        showToast('Listing not found. Please refresh.', 'error');
      } else if (error?.code === 'permission-denied') {
        showToast('You don’t have permission to bump this item.', 'error');
      } else {
        console.error('Hot bump error', error);
        showToast('Unable to bump item right now.', 'error');
      }
    } finally {
      setHotBumpLoadingId(null);
    }
  }, [user, db, sellerHotBumpCount, sellerHotBumpDayKey, appId, runFirestoreOp, showToast, hasFullUser]); // ===== HOT BUMP END ===== // DATA-ONLY

  const handlePasswordChange = async () => { // DATA-ONLY
    if (!newPassword || newPassword.length < 6) {
      setPasswordFeedback('Password must be at least 6 characters.'); // UI-ONLY
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordFeedback('Passwords do not match.'); // UI-ONLY
      return;
    }
    if (!auth.currentUser || user?.isAnonymous) {
      setPasswordFeedback('Sign in with email to change password.');
      return;
    }
    setPasswordProcessing(true); // UI-ONLY
    setPasswordFeedback(null); // UI-ONLY
    try {
      await updatePassword(auth.currentUser, newPassword); // DATA-ONLY
      setNewPassword('');
      setConfirmNewPassword('');
      showToast('Password updated'); // UI-ONLY
    } catch (error) {
      console.error('Password change error', error);
      if (error?.code === 'auth/requires-recent-login') {
        setPasswordFeedback('Please re-login to change your password.');
      } else {
        setPasswordFeedback('Unable to change password.');
      }
    } finally {
      setPasswordProcessing(false); // UI-ONLY
    }
  };

  const handleDeactivateAccount = async () => { // DATA-ONLY
    if (!hasFullUser || !db) {
      showToast('Sign in with full account to update privacy settings', 'error');
      return;
    }
    setPrivacyProcessing(true); // UI-ONLY
    setPrivacyFeedback(null); // UI-ONLY
    try {
      const profileRef = doc(db, 'artifacts', appId, 'users', user.uid); // DATA-ONLY
      await setDoc(profileRef, { uid: user.uid, appId, isDeactivated: true, updatedAt: serverTimestamp() }, { merge: true }); // DATA-ONLY
      setProfileForm((prev) => ({ ...prev, isDeactivated: true })); // DATA-ONLY
      showToast('Account deactivated'); // UI-ONLY
    } catch (error) {
      console.error('Deactivate error', error);
      setPrivacyFeedback('Unable to deactivate account.'); // UI-ONLY
    } finally {
      setPrivacyProcessing(false); // UI-ONLY
    }
  };

  const handleDeleteAccount = async () => { // DATA-ONLY
    if (deleteConfirm !== 'DELETE') {
      setDeleteFeedback('Type DELETE to confirm.'); // UI-ONLY
      return;
    }
    if (!hasFullUser || !db) {
      setDeleteFeedback('Sign in with your email account to delete permanently.');
      return;
    }
    setPrivacyProcessing(true); // UI-ONLY
    setDeleteFeedback(null); // UI-ONLY
    try {
      const addrCol = collection(db, 'artifacts', appId, 'users', user.uid, 'addresses'); // DATA-ONLY
      const addrSnapshot = await getDocs(addrCol); // DATA-ONLY
      await Promise.all(addrSnapshot.docs.map((docSnap) => deleteDoc(docSnap.ref))); // DATA-ONLY
      await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid)); // DATA-ONLY
      if (auth.currentUser) {
        await deleteUser(auth.currentUser); // DATA-ONLY
      }
      showToast('Account deleted'); // UI-ONLY
      setSettingsOpen(false); // UI-ONLY
      setView('home'); // UI-ONLY
    } catch (error) {
      console.error('Delete account error', error);
      if (error?.code === 'auth/requires-recent-login') {
        setDeleteFeedback('Please re-login to delete your account.');
      } else {
        setDeleteFeedback('Unable to delete account.');
      }
    } finally {
      setPrivacyProcessing(false); // UI-ONLY
    }
  };
  // ===== PROFILE SETTINGS END =====

  // Authentication Setup
  useEffect(() => {
    const initAuth = async () => {
      if (!firebaseConfig.apiKey) {
        console.warn("⚠️ NO VALID FIREBASE CONFIG FOUND.");
        setConfigError(true);
        setLoading(false);
        return; 
      }

      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else if (!auth.currentUser) {
          // Ensure Firestore rules that require auth are satisfied for read-only users.
          await signInAnonymously(auth);
        }
      } catch (e) {
        console.error("Auth Error:", e);
        setLoading(false);
      }
    };

    initAuth();
    
    let unsubscribe = () => {};
    try {
        unsubscribe = onAuthStateChanged(auth, (u) => {
          setUser(u); // FIX: permissions root cause
          setLoading(false); // FIX: permissions root cause
          setAuthReady(true); // FIX: permissions root cause
        });
    } catch(e) { console.error(e) }

    return () => unsubscribe();
  }, []);

  // Data Fetching (Products)
  useEffect(() => { // FIX: watch stream
    const opKey = 'LISTEN:marketplaceProducts'; // FIX: permissions
    if (productsUnsubRef.current) { productsUnsubRef.current(); productsUnsubRef.current = null; } // FIX: watch stream
    if (configError || !db) { // FIX: permissions
      setProducts([]); // FIX: permissions
      return; // FIX: watch stream
    }
    if (!authReady || !user?.uid) { // wait for an authenticated (even anonymous) user
      setProducts([]); // FIX: watch stream
      return; // FIX: watch stream
    }
    if (deniedOpsRef.current.has(opKey)) { // FIX: permissions
      setProducts([]); // FIX: permissions
      return; // FIX: watch stream
    }
    try { // FIX: watch stream
        const q = collection(db, 'artifacts', appId, 'public', 'data', 'products'); // FIX: watch stream
        logFirestoreEvent('START', opKey, { type: 'LISTEN', path: `artifacts/${appId}/public/data/products`, query: 'all items' }); // FIX: firestore instrumentation
        logListenerEvent(opKey, 'SUBSCRIBE', { path: `artifacts/${appId}/public/data/products`, query: 'all items' }); // FIX: listen instrumentation
        const unsub = onSnapshot(q, (snapshot) => { // FIX: watch stream
          logFirestoreEvent('FIRST-SNAP', opKey, { docsCount: snapshot.size }); // FIX: firestore instrumentation
          const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })); // FIX: watch stream
          setProducts(items); // FIX: watch stream
        }, (err) => { // FIX: watch stream
          logListenerEvent(opKey, 'ERROR', { path: `artifacts/${appId}/public/data/products`, query: 'all items', rawError: err, code: err?.code, message: err?.message, stack: err?.stack, name: err?.name }, true); // FIX: listen instrumentation
          logFirestoreEvent('ERROR', opKey, { code: err?.code, message: err?.message }); // FIX: firestore instrumentation
          if (isInternalFirestoreError(err)) { // FIX: firestore instrumentation
            blockFirestoreOp(opKey, 'internal-error', { path: `artifacts/${appId}/public/data/products`, query: 'all items' }); // FIX: firestore instrumentation
            if (productsUnsubRef.current) { productsUnsubRef.current(); productsUnsubRef.current = null; } // FIX: firestore instrumentation
            setProducts([]); // FIX: firestore instrumentation
            return; // FIX: firestore instrumentation
          }
          if (err?.code === 'permission-denied') { // FIX: watch stream
            markDeniedOp(opKey, { type: 'LISTEN', path: `artifacts/${appId}/public/data/products`, query: 'all items' }); // FIX: permissions
            setProducts([]); // FIX: watch stream
            if (productsUnsubRef.current) { productsUnsubRef.current(); productsUnsubRef.current = null; } // FIX: permissions
            return; // FIX: watch stream
          }
          if (err?.code === 'cancelled' || err?.code === 'unavailable') return; // FIX: watch stream
          console.error("Data fetch error", err); // FIX: watch stream
        });
        productsUnsubRef.current = () => {
          logListenerEvent(opKey, 'UNSUBSCRIBE', { path: `artifacts/${appId}/public/data/products`, query: 'all items' });
          unsub();
        };
    } catch (e) {
        console.log("Firestore unavailable", e); // FIX: watch stream
    }
    return () => {
      if (productsUnsubRef.current) {
        productsUnsubRef.current();
        productsUnsubRef.current = null;
      }
    }; // FIX: watch stream
  }, [configError, db, authReady, user?.uid, markDeniedOp, logFirestoreEvent, blockFirestoreOp, isInternalFirestoreError, logListenerEvent]); // FIX: permissions

  // Track Recent Searches
  useEffect(() => {
    if (searchQuery.length > 3 && !recentSearches.includes(searchQuery.toLowerCase())) {
        const timeoutId = setTimeout(() => {
             setRecentSearches(prev => [searchQuery.toLowerCase(), ...prev].slice(0, 5));
        }, 1500); 
        return () => clearTimeout(timeoutId);
    }
  }, [searchQuery]);

  useEffect(() => { // FIX: search input focus
    if (!activeSearchField) return; // FIX: search input focus
    const targetRef = activeSearchField === 'desktop' ? desktopSearchRef : mobileSearchRef; // FIX: search input focus
    const input = targetRef.current; // FIX: search input focus
    if (input && document.activeElement !== input) { // FIX: search input focus
      input.focus({ preventScroll: true }); // FIX: search input focus
      input.setSelectionRange(input.value.length, input.value.length); // FIX: search input focus
    } // FIX: search input focus
  }, [searchQuery, activeSearchField]); // FIX: search input focus
  useEffect(() => { // UI-ONLY
    if (typeof window === 'undefined' || typeof window.matchMedia === 'undefined') return;
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = () => setPrefersReducedMotion(mediaQuery.matches);
    handleChange();
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange);
    } else {
      mediaQuery.addListener(handleChange);
    }
    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener('change', handleChange);
      } else {
        mediaQuery.removeListener(handleChange);
      }
    };
  }, []); // UI-ONLY

  useEffect(() => { // UI-ONLY
    if (typeof window === 'undefined' || prefersReducedMotion) return;
    const handleScroll = () => { // UI-ONLY
      setHotPaused(true); // UI-ONLY
      if (hotScrollTimeoutRef.current) clearTimeout(hotScrollTimeoutRef.current); // UI-ONLY
      hotScrollTimeoutRef.current = setTimeout(() => { // UI-ONLY
        setHotPaused(false); // UI-ONLY
      }, 300); // UI-ONLY
    }; // UI-ONLY
    window.addEventListener('scroll', handleScroll, { passive: true }); // UI-ONLY
    return () => { // UI-ONLY
      window.removeEventListener('scroll', handleScroll); // UI-ONLY
      if (hotScrollTimeoutRef.current) clearTimeout(hotScrollTimeoutRef.current); // UI-ONLY
    }; // UI-ONLY
  }, [prefersReducedMotion]); // UI-ONLY

  const readUserBadge = useCallback(async (targetUser) => { // DATA-ONLY: badge
    const resolvedUser = targetUser || user; // DATA-ONLY: badge
    if (!resolvedUser || resolvedUser.isAnonymous || !db) return null; // DATA-ONLY: badge
    if (!targetUser && !hasFullUser) return null; // DATA-ONLY: badge
    try {
      const profileRef = doc(db, 'artifacts', appId, 'users', resolvedUser.uid); // FIX: permissions root cause
      const snap = await runFirestoreOp('READ:userBadge', 'READ', `artifacts/${appId}/users/${resolvedUser.uid}`, 'getDoc', () => getDoc(profileRef)); // FIX: permissions
      if (!snap) return null; // FIX: permissions
      return snap.exists() ? (snap.data().badge || null) : null; // DATA-ONLY: badge
    } catch (error) {
      console.warn('Badge fetch failed', error);
      return null;
    }
  }, [db, runFirestoreOp, appId, hasFullUser, user?.uid, user?.isAnonymous]); // DATA-ONLY: badge

  const assignEarlyBadgeIfEligible = useCallback(async (accountUser) => { // DATA-ONLY: badge
    const resolvedUser = accountUser || user; // DATA-ONLY: badge
    if (!resolvedUser || resolvedUser.isAnonymous || !db) return; // DATA-ONLY: badge
    if (!accountUser && !hasFullUser) return; // DATA-ONLY: badge
    try {
      await runFirestoreOp('TRANSACTION:earlyBird', 'WRITE', `artifacts/${appId}/meta/earlyBird`, 'assign badge', () => runTransaction(db, async (transaction) => { // FIX: permissions
        const metaRef = doc(db, 'artifacts', appId, 'meta', 'earlyBird'); // FIX: permissions root cause
        const userRef = doc(db, 'artifacts', appId, 'users', resolvedUser.uid); // FIX: permissions root cause
        const metaSnap = await transaction.get(metaRef); // DATA-ONLY: badge
        let count = 0;
        if (metaSnap.exists()) {
          count = metaSnap.data().count || 0;
        } else {
          transaction.set(metaRef, { count: 0 }, { merge: true }); // DATA-ONLY: badge
        }
        let badgeToAssign = null;
        if (resolvedUser.email === FOUNDER_EMAIL) {
          badgeToAssign = 'RIGX Founder';
        } else if (count < 100) {
          badgeToAssign = 'RIGX Pioneer';
          transaction.set(metaRef, { count: count + 1 }, { merge: true }); // DATA-ONLY: badge
        }
        const payload = { createdAt: serverTimestamp() };
        if (badgeToAssign) payload.badge = badgeToAssign;
        transaction.set(userRef, payload, { merge: true }); // DATA-ONLY: badge
      })); // FIX: permissions
    } catch (error) {
      console.warn('Early badge assignment failed', error);
    }
  }, [db, runFirestoreOp, appId, user, hasFullUser]); // DATA-ONLY: badge

  useEffect(() => { // DATA-ONLY
    if (!products || products.length === 0) {
      setHotItems([]);
      setHotLoading(false);
      return;
    }
    setHotLoading(true);
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const bumpedEntries = products
      .map((item) => {
        let bumpTime = null;
        if (item?.hotBumpAt?.seconds) {
          bumpTime = item.hotBumpAt.seconds * 1000;
        } else if (item?.hotBumpDayKey) {
          const parsed = parseDayKeyToMillis(item.hotBumpDayKey);
          bumpTime = parsed ? parsed : null;
        }
        return { item, bumpTime };
      })
      .filter(({ bumpTime }) => bumpTime && bumpTime >= sevenDaysAgo)
      .sort((a, b) => (b.bumpTime || 0) - (a.bumpTime || 0))
      .map(({ item }) => item)
      .slice(0, 10);
    const bumpedIds = new Set(bumpedEntries.map((entry) => entry.id));
    const remainingPool = products.filter((item) => item && !bumpedIds.has(item.id));
    const shuffledRemaining = [...remainingPool].sort(() => Math.random() - 0.5);
    const needed = Math.max(0, 10 - bumpedEntries.length);
    setHotItems([...bumpedEntries, ...shuffledRemaining.slice(0, needed)]);
    setHotLoading(false);
  }, [products]); // DATA-ONLY

  useEffect(() => { // DATA-ONLY: badge
    let cancelled = false; // DATA-ONLY: badge
    const syncBadge = async () => { // DATA-ONLY: badge
      if (!hasFullUser || !db) { // DATA-ONLY: badge
        setUserBadge(null); // DATA-ONLY: badge
        return; // DATA-ONLY: badge
      }
      try {
        if (user.email === FOUNDER_EMAIL) { // DATA-ONLY: badge
          const profileRef = doc(db, 'artifacts', appId, 'users', user.uid); // FIX: permissions root cause
          await runFirestoreOp('WRITE:setFounderBadge', 'WRITE', `artifacts/${appId}/users/${user.uid}`, 'setDoc founder', () => setDoc(profileRef, { uid: user.uid, appId, badge: 'RIGX Founder', createdAt: serverTimestamp() }, { merge: true })); // FIX: permissions
          if (!cancelled) setUserBadge('RIGX Founder'); // DATA-ONLY: badge
          return; // DATA-ONLY: badge
        }
        const badge = await readUserBadge(user); // DATA-ONLY: badge
        if (!cancelled) setUserBadge(badge); // DATA-ONLY: badge
      } catch (error) {
        console.warn('Badge sync error', error);
        const badge = await readUserBadge(user); // DATA-ONLY: badge
        if (!cancelled) setUserBadge(badge); // DATA-ONLY: badge
      }
    };
    syncBadge(); // DATA-ONLY: badge
    return () => {
      cancelled = true; // DATA-ONLY: badge
    };
  }, [user, readUserBadge, db, runFirestoreOp, hasFullUser]); // DATA-ONLY: badge

  // --- Draggable FAB Handlers ---
  const handleFabMouseDown = (e) => {
    if (e.type === 'mousedown' && e.button !== 0) return;
    isDraggingRef.current = false;
    const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
    const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;
    dragStartRef.current = { x: clientX, y: clientY };
    initialFabPosRef.current = { ...fabPos };
    document.addEventListener('mousemove', handleFabMouseMove);
    document.addEventListener('mouseup', handleFabMouseUp);
    document.addEventListener('touchmove', handleFabMouseMove, { passive: false });
    document.addEventListener('touchend', handleFabMouseUp);
  };

  const handleFabMouseMove = (e) => {
    const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
    const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;
    const dx = clientX - dragStartRef.current.x;
    const dy = clientY - dragStartRef.current.y;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) isDraggingRef.current = true;
    if (isDraggingRef.current) {
        if(e.cancelable) e.preventDefault(); 
        setFabPos({ x: initialFabPosRef.current.x + dx, y: initialFabPosRef.current.y + dy });
    }
  };

  const handleFabMouseUp = () => {
    document.removeEventListener('mousemove', handleFabMouseMove);
    document.removeEventListener('mouseup', handleFabMouseUp);
    document.removeEventListener('touchmove', handleFabMouseMove);
    document.removeEventListener('touchend', handleFabMouseUp);
  };

  const handleFabClick = (e) => {
      if (isDraggingRef.current) { e.preventDefault(); e.stopPropagation(); return; }
      // Toggle the menu instead of immediate support
      setSupportMenuOpen(!supportMenuOpen);
  };

  // --- Actions ---

  const handleAddToCart = (product) => {
    setCart(prev => {
      const existing = prev.find(item => item.id === product.id);
      if (existing) {
        return prev.map(item => item.id === product.id ? { ...item, qty: item.qty + 1 } : item);
      }
      return [...prev, { ...product, qty: 1 }];
    });
    showToast(`Added ${product.title} to cart`);
  };

  const toggleFavorite = (e, productId) => {
    e.stopPropagation(); 
    const newFavorites = new Set(favorites);
    if (newFavorites.has(productId)) {
        newFavorites.delete(productId);
        showToast("Removed from favorites", "success");
    } else {
        newFavorites.add(productId);
        showToast("Added to favorites", "success");
    }
    setFavorites(newFavorites);
  };

  const removeFromCart = (id) => {
    setCart(prev => prev.filter(item => item.id !== id));
  };

  const handlePublishProduct = async (productData) => {
    if (configError) { showToast("Missing Firebase Configuration", "error"); return; }
    if (!authReady || !user?.uid || user.isAnonymous) {
      showToast('Sign in to publish listings.', 'error');
      return;
    }
    try {
      await runFirestoreOp('WRITE:publishProduct', 'WRITE', `artifacts/${appId}/public/data/products`, 'addDoc listing', () => addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'products'), {
        ...productData,
        sellerId: user.uid,
        sellerName: user.displayName || 'Anonymous Seller',
        createdAt: serverTimestamp(),
        rating: 0,
        sales: 0
      }));
      showToast('Listing published successfully!');
      setView('seller-dashboard');
    } catch (e) {
      showToast('Error publishing listing: ' + e.message, 'error');
    }
  };

  // Review Submission Logic
  const handleSubmitReview = async (rating, comment) => {
    if (!reviewTarget) return;
    if (!authReady || !user?.uid || user.isAnonymous) {
      showToast('Sign in to leave a review.', 'error');
      setReviewModalOpen(false);
      return;
    }
    setLoading(true);
    try {
        await runFirestoreOp('WRITE:submitReview', 'WRITE', `artifacts/${appId}/public/data/reviews`, 'addDoc review', () => addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'reviews'), {
            sellerId: reviewTarget.sellerId,
            buyerId: user.uid,
            buyerName: user.displayName || 'Anonymous',
            rating: rating,
            comment: comment,
            productId: reviewTarget.itemId,
            productTitle: reviewTarget.itemTitle,
            createdAt: serverTimestamp()
        }));
        showToast("Review submitted! Thank you.", "success");
        setReviewModalOpen(false);
        setReviewTarget(null);
    } catch (e) {
        showToast("Failed to submit review: " + e.message, "error");
    } finally {
        setLoading(false);
    }
  };

  const startChat = (sellerId, subject, initialMessage = null) => {
    const chatID = [user?.uid || 'guest', sellerId].sort().join('_');
    const newChat = {
      id: chatID,
      participants: [user?.uid || 'guest', sellerId],
      subject: subject,
      messages: initialMessage ? [{sender: user?.displayName || 'Me', text: initialMessage}] : []
    };
    setActiveChat(newChat);
    setView('chat');
  };

  const handleSupportClick = () => {
      const supportChat = {
        id: 'support_ticket',
        participants: [user?.uid || 'guest', 'support'],
      subject: 'RigX Support', 
      messages: [{sender: 'Support Bot', text: 'Hello! Need help with your build or finding a part? Ask us anything!'}]
    };
    setActiveChat(supportChat);
    setView('chat');
  };

  const contactSellerFromCart = useCallback(() => {
    if (cart.length === 0) {
      showToast('Add items to your cart before contacting sellers.', 'error');
      return;
    }
    const targetItem = cart[0];
    if (targetItem?.sellerId) {
      const intro = `Hi! I'm interested in ${targetItem.title}. Let's arrange payment and delivery.`;
      startChat(targetItem.sellerId, targetItem.title, intro);
      showToast('Opened chat with the seller. Coordinate payment directly there.');
    } else {
      handleSupportClick();
    }
  }, [cart, startChat, showToast, handleSupportClick]);

  // --- Filtering Logic ---
  const filteredProducts = useMemo(() => {
    const normalizedSelectedState = selectedState.trim().toLowerCase(); // FIX: state filter
    return products.filter(p => {
      const matchesSearch = p.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                            p.category.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = selectedCategory ? p.category === selectedCategory : true;
      const matchesSwap = showSwapOnly ? (p.listingType === 'swap' || p.listingType === 'both') : true;
      const matchesState = selectedState === 'all' ? true : (() => { // FIX: state filter
        const stateValue = (p.state || '').trim().toLowerCase(); // FIX: state filter
        if (stateValue) return stateValue === normalizedSelectedState; // FIX: state filter
        const locationValue = (p.location || '').toLowerCase(); // FIX: state filter
        if (locationValue) return locationValue.includes(normalizedSelectedState); // FIX: state filter
        return true; // FIX: state filter
      })(); // FIX: state filter
      return matchesSearch && matchesCategory && matchesSwap && matchesState; // FIX: state filter
    });
  }, [products, searchQuery, selectedCategory, showSwapOnly, selectedState]); // FIX: state filter
  const hasRecentProducts = useMemo(() => { // UI-ONLY: dynamic badge
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000; // UI-ONLY: dynamic badge
    return products.some((product) => { // UI-ONLY: dynamic badge
      const createdValue = product?.createdAt || product?.created_at || product?.timestamp; // UI-ONLY: dynamic badge
      if (!createdValue) return false; // UI-ONLY: dynamic badge
      let createdDate = null; // UI-ONLY: dynamic badge
      if (typeof createdValue?.toDate === 'function') { // UI-ONLY: dynamic badge
        createdDate = createdValue.toDate(); // UI-ONLY: dynamic badge
      } else if (typeof createdValue === 'object' && typeof createdValue?.seconds === 'number') { // UI-ONLY: dynamic badge
        createdDate = new Date(createdValue.seconds * 1000); // UI-ONLY: dynamic badge
      } else if (typeof createdValue === 'number') { // UI-ONLY: dynamic badge
        createdDate = new Date(createdValue); // UI-ONLY: dynamic badge
      } else if (typeof createdValue === 'string') { // UI-ONLY: dynamic badge
        const parsed = new Date(createdValue); // UI-ONLY: dynamic badge
        if (!Number.isNaN(parsed.getTime())) createdDate = parsed; // UI-ONLY: dynamic badge
      } // UI-ONLY: dynamic badge
      if (!createdDate || Number.isNaN(createdDate.getTime())) return false; // UI-ONLY: dynamic badge
      return createdDate.getTime() >= dayAgo; // UI-ONLY: dynamic badge
    }); // UI-ONLY: dynamic badge
  }, [products]); // UI-ONLY: dynamic badge
  const marketplaceBadgeLabel = useMemo(() => { // UI-ONLY: dynamic badge
    if ((hotItems?.length || 0) > 0) return 'LIVE'; // UI-ONLY: dynamic badge
    if (hasRecentProducts) return 'NEW'; // UI-ONLY: dynamic badge
    return 'READY'; // UI-ONLY: dynamic badge
  }, [hotItems, hasRecentProducts]); // UI-ONLY: dynamic badge
  const marketplaceBadgeStyle = useMemo(() => { // UI-ONLY: dynamic badge
    if (marketplaceBadgeLabel === 'LIVE') return 'text-emerald-300 border-emerald-400/40 bg-emerald-500/10'; // UI-ONLY: dynamic badge
    if (marketplaceBadgeLabel === 'NEW') return 'text-cyan-300 border-cyan-400/40 bg-cyan-500/10'; // UI-ONLY: dynamic badge
    return 'text-gray-300 border-gray-400/30 bg-white/5'; // UI-ONLY: dynamic badge
  }, [marketplaceBadgeLabel]); // UI-ONLY: dynamic badge
  const featuredProducts = useMemo(() => {
     return [...products].sort((a,b) => b.price - a.price).slice(0, 4);
  }, [products]);

  const recommendedProducts = useMemo(() => {
     if (!user || products.length === 0) return [];
     const favCategories = new Set();
     products.forEach(p => {
         if (favorites.has(p.id)) favCategories.add(p.category);
     });
     return products.filter(p => {
         const matchesFavCategory = favCategories.has(p.category);
         const matchesRecentSearch = recentSearches.some(term => 
             p.title.toLowerCase().includes(term) || p.category.includes(term)
         );
         if (favCategories.size === 0 && recentSearches.length === 0) return false;
         return matchesFavCategory || matchesRecentSearch;
     }).slice(0, 8); 
  }, [products, favorites, recentSearches, user]);

  // --- Sub Views ---

  // New Component: Repair Modal (Formerly Repair Section)
  const RepairModal = () => {
      if (!repairModalOpen) return null;

      return (
        <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-slate-900 rounded-2xl w-full max-w-2xl border border-blue-500/30 relative overflow-hidden shadow-2xl">
              <button 
                  onClick={() => setRepairModalOpen(false)}
                  className="absolute top-4 right-4 text-gray-400 hover:text-white z-20"
              >
                  <X size={24} />
              </button>
              
              <div className="bg-gradient-to-r from-blue-900/50 to-slate-900/50 p-8 relative">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
                    
                    <div className="relative z-10">
                      <div className="text-center md:text-left mb-6">
                        <div className="flex items-center justify-center md:justify-start gap-2 mb-2">
                          <Wrench className="text-blue-400" size={24} />
                          <h2 className="text-2xl font-bold text-white">PC or Laptop Problems?</h2>
                        </div>
                        <h3 className="text-xl font-semibold text-blue-400 mb-4">Genius Advanced Authorized Repair Centre</h3>
                        <p className="text-gray-300 mb-6 text-base leading-relaxed">
                          Don't let hardware failure stop your game. As the official authorized repair partner for RIGX, 
                          Genius Advanced offers professional diagnosis, repairs, and upgrades for all your gaming rigs and laptops.
                        </p>
                        <div className="flex flex-wrap justify-center md:justify-start gap-4 mb-8">
                          <div className="flex items-center gap-2 text-sm text-gray-400 bg-slate-800/80 px-3 py-1.5 rounded-full border border-slate-700">
                            <CheckCircle size={14} className="text-green-400"/> Professional Diagnosis
                          </div>
                          <div className="flex items-center gap-2 text-sm text-gray-400 bg-slate-800/80 px-3 py-1.5 rounded-full border border-slate-700">
                            <CheckCircle size={14} className="text-green-400"/> Hardware Repair
                          </div>
                          <div className="flex items-center gap-2 text-sm text-gray-400 bg-slate-800/80 px-3 py-1.5 rounded-full border border-slate-700">
                            <CheckCircle size={14} className="text-green-400"/> Deep Cleaning
                          </div>
                        </div>
                        
                        <button 
                          onClick={() => window.open('https://wa.me/601114888499', '_blank')} 
                          className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl shadow-lg shadow-blue-600/20 transition-all flex items-center justify-center gap-2"
                        >
                          <MessageSquare size={18}/> Contact Genius Advanced (WhatsApp)
                        </button>
                      </div>
                      <p className="text-xs text-center text-gray-500">Located in Bandar Baru Bangi & Cyberjaya • Official Partner</p>
                    </div>
              </div>
          </div>
        </div>
      );
  };

  const renderSettingsModal = () => { // ===== PROFILE SETTINGS START ===== // UI-ONLY // FIX: settings focus
      if (!settingsOpen) return null; // UI-ONLY
      return (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 px-4 py-6">
          <div className={`w-full max-w-5xl rounded-[32px] border border-white/10 bg-slate-950/95 text-white shadow-2xl ${prefersReducedMotion ? '' : 'settings-shell'}`}>
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
              <div>
                <p className="text-xs uppercase tracking-[0.4em] text-cyan-300/80">RigX</p>
                <h3 className="text-2xl font-black">Account Settings</h3>
              </div>
              <button onClick={() => setSettingsOpen(false)} className="rounded-full border border-white/20 p-2 text-gray-400 hover:text-white">
                <X size={18}/>
              </button>
            </div>
            <div className="flex flex-col md:flex-row">
              <div className="w-full border-b border-white/10 md:w-56 md:border-b-0 md:border-r md:border-white/10">
                <div className="flex md:flex-col">
                  {SETTINGS_TABS.map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setSettingsTab(tab.id)}
                      className={`flex-1 px-4 py-3 text-sm font-semibold transition md:text-left ${settingsTab === tab.id ? 'bg-cyan-500/10 text-white border-b border-cyan-400/40 md:border-l-4 md:border-l-cyan-400/70' : 'text-gray-400 hover:text-white border-b border-white/5 md:border-b-0 md:border-l-4 md:border-l-transparent'}`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex-1 max-h-[70vh] overflow-y-auto p-6 space-y-8">
                {settingsTab === 'profile' && (
                  <div className="space-y-6">
                    {profileLoading && <p className="text-sm text-gray-400">Loading profile...</p>}
                    <div className="flex flex-col gap-6 lg:flex-row">
                      <div>
                        <p className="text-sm text-gray-400 mb-2">Profile Picture</p>
                        <div className="flex items-center gap-4">
                          <div className="w-24 h-24 rounded-full border-2 border-cyan-500/60 bg-slate-900 flex items-center justify-center text-3xl font-bold">
                            {profileForm.photoURL ? (
                              <img src={profileForm.photoURL} alt="Avatar" className="w-full h-full object-cover rounded-full"/>
                            ) : (
                              (profileForm.displayName?.[0]?.toUpperCase() || 'U')
                            )}
                          </div>
                          <label className="cursor-pointer rounded-full border border-cyan-400/40 px-4 py-2 text-sm text-cyan-200 hover:bg-cyan-500/10">
                            {avatarUploading ? 'Uploading...' : 'Upload Avatar'}
                            <input type="file" accept="image/*" className="hidden" disabled={avatarUploading} onChange={(e) => e.target.files?.[0] && handleAvatarUpload(e.target.files[0])}/>
                          </label>
                        </div>
                      </div>
                      <div className="flex-1 space-y-3">
                        <label className="block text-sm text-gray-400">Display Name</label>
                        <input className="w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2" value={profileForm.displayName} onChange={(e) => setProfileForm((prev) => ({ ...prev, displayName: e.target.value }))}/>
                        <label className="block text-sm text-gray-400">Phone</label>
                        <input className="w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2" value={profileForm.phone} onChange={(e) => setProfileForm((prev) => ({ ...prev, phone: e.target.value }))}/>
                        <label className="block text-sm text-gray-400">Bio</label>
                        <textarea className="w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2" rows={3} value={profileForm.bio} onChange={(e) => setProfileForm((prev) => ({ ...prev, bio: e.target.value }))}/>
                      </div>
                    </div>
                    <button onClick={handleProfileSave} disabled={profileSaving} className="rounded-full bg-gradient-to-r from-cyan-500 to-purple-600 px-6 py-2 text-sm font-semibold disabled:opacity-50">
                      {profileSaving ? 'Saving...' : 'Save Profile'}
                    </button>
                  </div>
                )}

                {settingsTab === 'payment' && (
                  <div className="space-y-4">
                    <p className="text-sm text-gray-300">
                      RigX no longer processes payments in-app. Connect with sellers through chat to arrange
                      payment and delivery externally, just like Carousell.
                    </p>
                    <p className="text-xs text-gray-500">
                      Use the chat button on listings to coordinate meetups, transfers, or any preferred method.
                    </p>
                  </div>
                )}

                {settingsTab === 'addresses' && (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <h4 className="text-lg font-semibold">Saved Addresses</h4>
                      <button onClick={resetAddressForm} className="text-xs text-cyan-300 hover:text-white">Add New</button>
                    </div>
                    {addressesLoading ? (
                      <p className="text-sm text-gray-400">Loading addresses...</p>
                    ) : (
                      <div className="space-y-3">
                        {addresses.map((addr) => (
                          <div key={addr.id} className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <p className="text-sm font-semibold">{addr.label || 'Address'}</p>
                                <p className="text-xs text-gray-400">{addr.recipientName} • {addr.phone}</p>
                              </div>
                              {addr.isDefault && <span className="rounded-full border border-cyan-400/40 px-3 py-1 text-xs text-cyan-200">Default</span>}
                            </div>
                            <p className="mt-2 text-sm text-gray-300">{addr.line1}{addr.line2 ? `, ${addr.line2}` : ''}, {addr.city}, {addr.state} {addr.postcode}</p>
                            <div className="mt-3 flex flex-wrap gap-2 text-xs">
                              <button onClick={() => startEditingAddress(addr)} className="rounded-full border border-white/20 px-3 py-1 text-gray-300">Edit</button>
                              <button onClick={() => handleAddressDelete(addr.id)} className="rounded-full border border-red-500/40 px-3 py-1 text-red-300">Delete</button>
                              {!addr.isDefault && (
                                <button onClick={() => handleSetDefaultAddress(addr.id)} className="rounded-full border border-cyan-400/50 px-3 py-1 text-cyan-200">Set Default</button>
                              )}
                            </div>
                          </div>
                        ))}
                        {addresses.length === 0 && <p className="text-sm text-gray-500">No addresses saved yet.</p>}
                      </div>
                    )}
                    <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-4 space-y-3">
                      <h4 className="text-lg font-semibold">{editingAddressId ? 'Edit Address' : 'Add Address'}</h4>
                      {addressError && <p className="text-sm text-red-400">{addressError}</p>}
                      <div className="grid gap-3 md:grid-cols-2">
                        <input className="rounded-lg border border-white/10 bg-slate-950/40 px-3 py-2" placeholder="Label" value={addressForm.label} onChange={(e) => setAddressForm((prev) => ({ ...prev, label: e.target.value }))}/>
                        <input className="rounded-lg border border-white/10 bg-slate-950/40 px-3 py-2" placeholder="Recipient Name" value={addressForm.recipientName} onChange={(e) => setAddressForm((prev) => ({ ...prev, recipientName: e.target.value }))}/>
                        <input className="rounded-lg border border-white/10 bg-slate-950/40 px-3 py-2" placeholder="Phone" value={addressForm.phone} onChange={(e) => setAddressForm((prev) => ({ ...prev, phone: e.target.value }))}/>
                        <select className="rounded-lg border border-white/10 bg-slate-950/40 px-3 py-2" value={addressForm.state} onChange={(e) => setAddressForm((prev) => ({ ...prev, state: e.target.value }))}>
                          {MALAYSIAN_STATES.map((state) => <option key={state}>{state}</option>)}
                        </select>
                      </div>
                      <input className="rounded-lg border border-white/10 bg-slate-950/40 px-3 py-2" placeholder="Address Line 1" value={addressForm.line1} onChange={(e) => setAddressForm((prev) => ({ ...prev, line1: e.target.value }))}/>
                      <input className="rounded-lg border border-white/10 bg-slate-950/40 px-3 py-2" placeholder="Address Line 2" value={addressForm.line2} onChange={(e) => setAddressForm((prev) => ({ ...prev, line2: e.target.value }))}/>
                      <div className="grid gap-3 md:grid-cols-2">
                        <input className="rounded-lg border border-white/10 bg-slate-950/40 px-3 py-2" placeholder="City" value={addressForm.city} onChange={(e) => setAddressForm((prev) => ({ ...prev, city: e.target.value }))}/>
                        <input className="rounded-lg border border-white/10 bg-slate-950/40 px-3 py-2" placeholder="Postcode" value={addressForm.postcode} onChange={(e) => setAddressForm((prev) => ({ ...prev, postcode: e.target.value }))}/>
                      </div>
                      <label className="flex items-center gap-2 text-sm text-gray-300">
                        <input type="checkbox" checked={addressForm.isDefault} onChange={(e) => setAddressForm((prev) => ({ ...prev, isDefault: e.target.checked }))}/>
                        Set as default
                      </label>
                      <div className="flex gap-3">
                        <button onClick={handleAddressSave} disabled={addressSaving} className="rounded-full bg-gradient-to-r from-cyan-500 to-purple-600 px-5 py-2 text-sm font-semibold disabled:opacity-50">
                          {addressSaving ? 'Saving...' : editingAddressId ? 'Update Address' : 'Add Address'}
                        </button>
                        {editingAddressId && (
                          <button onClick={resetAddressForm} className="rounded-full border border-white/20 px-5 py-2 text-sm text-gray-300">
                            Cancel
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {settingsTab === 'privacy' && (
                  <div className="space-y-6">
                    <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-4 space-y-3">
                      <h4 className="text-lg font-semibold">Change Password</h4>
                      {passwordFeedback && <p className="text-sm text-orange-400">{passwordFeedback}</p>}
                      <input type="password" placeholder="New password" className="w-full rounded-lg border border-white/10 bg-slate-950/40 px-3 py-2" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}/>
                      <input type="password" placeholder="Confirm password" className="w-full rounded-lg border border-white/10 bg-slate-950/40 px-3 py-2" value={confirmNewPassword} onChange={(e) => setConfirmNewPassword(e.target.value)}/>
                      <button onClick={handlePasswordChange} disabled={passwordProcessing} className="rounded-full bg-gradient-to-r from-cyan-500 to-purple-600 px-5 py-2 text-sm font-semibold disabled:opacity-50">
                        {passwordProcessing ? 'Updating...' : 'Update Password'}
                      </button>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-4 space-y-3">
                      <h4 className="text-lg font-semibold">Data & Privacy</h4>
                      {privacyFeedback && <p className="text-sm text-orange-400">{privacyFeedback}</p>}
                      <button onClick={handleDeactivateAccount} disabled={privacyProcessing || profileForm.isDeactivated} className="w-full rounded-full border border-orange-400/50 px-5 py-2 text-sm text-orange-300 disabled:opacity-40">
                        {profileForm.isDeactivated ? 'Account Deactivated' : 'Deactivate Account'}
                      </button>
                      <div className="space-y-2">
                        <p className="text-xs text-gray-400">Delete account permanently:</p>
                        <input className="w-full rounded-lg border border-white/10 bg-slate-950/40 px-3 py-2 text-sm" placeholder='Type "DELETE" to confirm' value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)}/>
                        {deleteFeedback && <p className="text-xs text-red-400">{deleteFeedback}</p>}
                        <button onClick={handleDeleteAccount} disabled={privacyProcessing} className="w-full rounded-full bg-red-600/80 px-5 py-2 text-sm font-semibold disabled:opacity-50">
                          {privacyProcessing ? 'Processing...' : 'Delete Account'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {settingsTab === 'about' && (
                  <div className="space-y-3">
                    <h4 className="text-lg font-semibold">About RigX</h4>
                    <p className="text-sm text-gray-400">RigX Marketplace empowers Malaysian gamers with premium buying and selling tools, curated community highlights, and verified support.</p> {/* // UI-ONLY */}
                    <p className="text-xs text-gray-500">Version 1.0.0</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      );
  }; // ===== PROFILE SETTINGS END ===== // FIX: settings focus

  // Support Menu (Shows when Ask RIGX is clicked)
  const SupportMenu = () => {
      if (!supportMenuOpen) return null;
      return (
          <div 
            style={{ 
                // Removed complex bottom calculation that was causing the 'auto' bug
                transform: `translate(${fabPos.x}px, ${fabPos.y}px)`,
                touchAction: 'none'
            }}
            className="fixed bottom-36 right-4 md:bottom-24 md:right-8 z-50 flex flex-col gap-3 items-end animate-fade-in"
          >
              <button 
                  onClick={() => { setRepairModalOpen(true); setSupportMenuOpen(false); }}
                  className="bg-white text-slate-900 px-5 py-2.5 rounded-full font-bold shadow-xl flex items-center gap-2 hover:bg-gray-100 transition-colors border-2 border-blue-500"
              >
                  <Wrench size={18} className="text-blue-600"/> Repair Services
              </button>
              <button 
                  onClick={() => { handleSupportClick(); setSupportMenuOpen(false); }}
                  className="bg-white text-slate-900 px-5 py-2.5 rounded-full font-bold shadow-xl flex items-center gap-2 hover:bg-gray-100 transition-colors"
              >
                  <MessageCircleQuestion size={18} className="text-cyan-600"/> General Support
              </button>
          </div>
      );
  };

  // New Component: Review Modal
  const ReviewModal = () => {
      const [rating, setRating] = useState(5);
      const [comment, setComment] = useState('');
      
      if (!reviewModalOpen) return null;

      return (
          <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4 animate-fade-in">
              <div className="bg-slate-800 rounded-xl p-6 w-full max-w-md border border-slate-700 relative shadow-2xl">
                  <button 
                      onClick={() => setReviewModalOpen(false)}
                      className="absolute top-4 right-4 text-gray-400 hover:text-white"
                  >
                      <X size={20} />
                  </button>
                  <h2 className="text-xl font-bold text-white mb-1">Rate Seller</h2>
                  <p className="text-gray-400 text-sm mb-6">How was your experience buying <b>{reviewTarget?.itemTitle}</b>?</p>
                  
                  <div className="flex flex-col items-center mb-6">
                      <StarRating rating={rating} setRating={setRating} size={32} />
                      <span className="text-cyan-400 font-bold mt-2 text-lg">
                          {rating === 5 ? 'Excellent!' : rating === 4 ? 'Great' : rating === 3 ? 'Good' : rating === 2 ? 'Fair' : 'Poor'}
                      </span>
                  </div>

                  <div className="mb-6">
                      <label className="block text-sm text-gray-400 mb-2">Your Review</label>
                      <textarea
                          className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 text-white focus:border-cyan-500 outline-none resize-none"
                          rows="4"
                          placeholder="Tell others about the item condition, packaging, and seller response..."
                          value={comment}
                          onChange={(e) => setComment(e.target.value)}
                      />
                  </div>

                  <button 
                      onClick={() => handleSubmitReview(rating, comment)}
                      className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-lg shadow-lg shadow-cyan-600/20"
                  >
                      Submit Review
                  </button>
              </div>
          </div>
      );
  };

  const AuthView = ({ mode }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState(''); // FIX: confirm password
    const [isLogin, setIsLogin] = useState(mode === 'login');
    const [resetLoading, setResetLoading] = useState(false); // FIX: forgot password

    const handleAuth = async (e) => {
        e.preventDefault();
        if (!isLogin) { // FIX: confirm password
            if (!confirmPassword.trim()) { // FIX: confirm password
                showToast("Please retype your password.", "error"); // FIX: confirm password
                return; // FIX: confirm password
            } // FIX: confirm password
            if (password !== confirmPassword) { // FIX: confirm password
                showToast("Passwords do not match.", "error"); // FIX: confirm password
                return; // FIX: confirm password
            } // FIX: confirm password
        } // FIX: confirm password
        setLoading(true);
        try {
            if (isLogin) {
                await signInWithEmailAndPassword(auth, email, password);
                showToast("Welcome back!", "success");
            } else {
                const cred = await createUserWithEmailAndPassword(auth, email, password);
                await updateProfile(cred.user, { displayName: email.split('@')[0] });
                await assignEarlyBadgeIfEligible(cred.user); // DATA-ONLY: badge
                const badge = await readUserBadge(cred.user); // DATA-ONLY: badge
                setUserBadge(badge); // DATA-ONLY: badge
                showToast("Account created successfully!", "success");
                setConfirmPassword(''); // FIX: confirm password
            }
            setView('home');
        } catch (error) {
            showToast(error.message, "error");
        } finally {
            setLoading(false);
        }
    };

    const handlePasswordReset = async () => { // FIX: forgot password
        if (!email.trim()) {
            showToast("Enter your email to reset password.", "error");
            return;
        }
        setResetLoading(true);
        try {
            await sendPasswordResetEmail(auth, email.trim());
            showToast("Password reset email sent. Check your inbox/spam.", "success");
        } catch (error) {
            if (error.code === 'auth/invalid-email') {
                showToast("Invalid email.", "error");
            } else {
                showToast("If an account exists, you'll receive an email.", "success");
            }
        } finally {
            setResetLoading(false);
        }
    };

    return (
        // ===== LOGIN UI START (GAMING AUTO-EDIT) ===== // UI-ONLY
        <div className="relative flex min-h-[80vh] w-full items-center justify-center overflow-hidden bg-[#03040b] px-4 py-16"> {/* // UI-ONLY */}
            {/* // UI-ONLY */}
            <div className="absolute inset-0 pointer-events-none" aria-hidden="true"> {/* // UI-ONLY */}
                {/* // UI-ONLY */}
                <div className="gpu-panel absolute inset-y-10 left-[10%] right-[10%] rounded-[40px] border border-cyan-600/20 bg-gradient-to-r from-[#071627] via-[#050910] to-[#0a111d] opacity-70 blur-[1px]"></div> {/* // UI-ONLY */}
                {/* // UI-ONLY */}
                <div className="gpu-panel absolute -left-16 top-12 h-32 w-72 rotate-6 rounded-3xl border border-white/5 bg-gradient-to-r from-transparent via-cyan-500/10 to-transparent"></div> {/* // UI-ONLY */}
                {/* // UI-ONLY */}
                <div className="gpu-panel absolute bottom-10 right-0 h-24 w-72 -rotate-3 rounded-3xl border border-purple-500/10 bg-gradient-to-r from-transparent via-purple-400/20 to-transparent"></div> {/* // UI-ONLY */}
                {/* // UI-ONLY */}
                <div className="gpu-circuit absolute inset-0"></div> {/* // UI-ONLY */}
                {/* // UI-ONLY */}
                <div className="gpu-fan absolute left-10 top-1/4 h-48 w-48 rounded-full border border-cyan-500/10"></div> {/* // UI-ONLY */}
                {/* // UI-ONLY */}
                <div className="gpu-fan absolute right-0 top-1/3 h-36 w-36 rounded-full border border-purple-500/10"></div> {/* // UI-ONLY */}
                {/* // UI-ONLY */}
                <div className="gpu-shimmer absolute inset-0"></div> {/* // UI-ONLY */}
            </div>
            {/* // UI-ONLY */}
            <div className="relative z-10 w-full max-w-md"> {/* // UI-ONLY */}
                {/* // UI-ONLY */}
                <div className="gaming-card relative rounded-[28px] border border-white/5 bg-gradient-to-br from-[#071727]/80 via-[#050c15]/95 to-[#050912]/90 p-[1px] shadow-[0_25px_80px_rgba(0,0,0,0.65)]"> {/* // UI-ONLY */}
                    {/* // UI-ONLY */}
                    <div className="relative rounded-[26px] bg-[#040812]/95 px-8 py-10 backdrop-blur-xl"> {/* // UI-ONLY */}
                        {/* // UI-ONLY */}
                        <div className="mb-6 flex items-center justify-center gap-3 text-[0.75rem] uppercase tracking-[0.4em] text-cyan-200/70"> {/* // UI-ONLY */}
                            <span className="h-px w-8 bg-gradient-to-r from-transparent via-cyan-500/60 to-transparent"></span> {/* // UI-ONLY */}
                            <span>RigX Access</span> {/* // UI-ONLY */}
                            <span className="h-px w-8 bg-gradient-to-r from-transparent via-purple-500/60 to-transparent"></span> {/* // UI-ONLY */}
                        </div>
                        {/* // UI-ONLY */}
                        <h2 className="text-center text-3xl font-black text-white">{isLogin ? 'Login' : 'Register'}</h2> {/* // UI-ONLY */}
                        {/* // UI-ONLY */}
                        <p className="mt-2 text-center text-sm text-cyan-100/70">Authenticate to deploy your next upgrade.</p> {/* // UI-ONLY */}
                        {/* // UI-ONLY */}
                        <form onSubmit={handleAuth} className="mt-8 space-y-4"> {/* // UI-ONLY */}
                            {/* // UI-ONLY */}
                            <div className="space-y-2"> {/* // UI-ONLY */}
                                {/* // UI-ONLY */}
                                <label className="block text-sm font-medium text-gray-300">Email</label> {/* // UI-ONLY */}
                                {/* // UI-ONLY */}
                                <div className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 ring-offset-2 transition focus-within:border-cyan-500/60 focus-within:ring-2 focus-within:ring-cyan-500/30"> {/* // UI-ONLY */}
                                    {/* // UI-ONLY */}
                                    <input type="email" required className="w-full bg-transparent text-white placeholder-gray-500 outline-none" value={email} onChange={e=>setEmail(e.target.value)} /> {/* // UI-ONLY */}
                                </div>
                            </div>
                            {/* // UI-ONLY */}
                            <div className="space-y-2"> {/* // UI-ONLY */}
                                {/* // UI-ONLY */}
                                <label className="block text-sm font-medium text-gray-300">Password</label> {/* // UI-ONLY */}
                                {/* // UI-ONLY */}
                                <div className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 ring-offset-2 transition focus-within:border-cyan-500/60 focus-within:ring-2 focus-within:ring-cyan-500/30"> {/* // UI-ONLY */}
                                    {/* // UI-ONLY */}
                                    <input type="password" required className="w-full bg-transparent text-white placeholder-gray-500 outline-none" value={password} onChange={e=>setPassword(e.target.value)} /> {/* // UI-ONLY */}
                                </div>
                            </div>
                            {!isLogin && ( /* // FIX: confirm password */
                                <div className="space-y-2"> {/* // FIX: confirm password */}
                                    <label className="block text-sm font-medium text-gray-300">Confirm Password</label> {/* // FIX: confirm password */}
                                    <div className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 ring-offset-2 transition focus-within:border-cyan-500/60 focus-within:ring-2 focus-within:ring-cyan-500/30"> {/* // FIX: confirm password */}
                                        <input
                                            type="password"
                                            required
                                            className="w-full bg-transparent text-white placeholder-gray-500 outline-none"
                                            value={confirmPassword}
                                            onChange={(e) => setConfirmPassword(e.target.value)}
                                        /> {/* // FIX: confirm password */}
                                    </div>
                                </div>
                            )} {/* // FIX: confirm password */}
                            {/* // UI-ONLY */}
                            <button type="submit" className="gaming-button relative w-full overflow-hidden rounded-2xl bg-gradient-to-r from-cyan-500 via-blue-600 to-purple-600 py-3 text-lg font-bold text-white shadow-2xl shadow-cyan-600/30 transition-transform hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"> {/* // UI-ONLY */}
                                <span className="relative z-10">{isLogin ? 'Sign In' : 'Sign Up'}</span> {/* // UI-ONLY */}
                            </button>
                            {isLogin && ( // FIX: forgot password
                                <button
                                    type="button"
                                    onClick={handlePasswordReset}
                                    disabled={resetLoading}
                                    className="block w-full text-right text-sm font-semibold text-cyan-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {resetLoading ? 'Sending...' : 'Forgot Password?'} {/* FIX: forgot password */}
                                </button>
                            )} {/* FIX: forgot password */}
                        </form>
                        {/* // UI-ONLY */}
                        <div className="mt-6 text-center text-sm text-cyan-200/80"> {/* // UI-ONLY */}
                            <button onClick={() => setIsLogin(!isLogin)} className="font-semibold tracking-wide text-cyan-300 hover:text-white"> {/* // UI-ONLY */}
                                {isLogin ? "Don't have an account? Sign Up" : "Already have an account? Sign In"} {/* // UI-ONLY */}
                            </button>
                        </div>
                        {/* // UI-ONLY */}
                        <div className="mt-6 border-t border-white/5 pt-4 text-center"> {/* // UI-ONLY */}
                            {/* // UI-ONLY */}
                            <button onClick={() => { signInAnonymously(auth); setView('home'); }} className="text-xs uppercase tracking-[0.3em] text-gray-400 transition hover:text-white"> {/* // UI-ONLY */}
                                Continue as Guest {/* // UI-ONLY */}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        // ===== LOGIN UI END (GAMING AUTO-EDIT) ===== // UI-ONLY
    );
  };

  const ProductDetailView = () => {
    const [sellerReviews, setSellerReviews] = useState([]);
    const [avgRating, setAvgRating] = useState(0);
    const reviewsUnsubRef = useRef(null); // FIX: watch stream

    // Fetch reviews for this seller
    useEffect(() => {
        const opKey = 'LISTEN:sellerReviews'; // FIX: permissions
        if (reviewsUnsubRef.current) {
            reviewsUnsubRef.current();
            reviewsUnsubRef.current = null;
        } // FIX: watch stream
        if (!authReady || !user?.uid) {
            setSellerReviews([]);
            setAvgRating(0);
            return;
        }
        if (deniedOpsRef.current.has(opKey) || !db || !selectedProduct?.sellerId) { // FIX: permissions
            setSellerReviews([]);
            setAvgRating(0);
            return;
        } // FIX: watch stream
        
        try { // FIX: watch stream
            const q = query(
                collection(db, 'artifacts', appId, 'public', 'data', 'reviews'),
                where('sellerId', '==', selectedProduct.sellerId),
                orderBy('createdAt', 'desc'),
                limit(10)
            ); // FIX: watch stream

            logFirestoreEvent('START', opKey, { type: 'LISTEN', path: `artifacts/${appId}/public/data/reviews`, query: `sellerId == ${selectedProduct.sellerId}` }); // FIX: firestore instrumentation
            logListenerEvent(opKey, 'SUBSCRIBE', { path: `artifacts/${appId}/public/data/reviews`, query: `sellerId == ${selectedProduct.sellerId}` });
            const reviewsUnsub = onSnapshot(q, (snapshot) => {
                logFirestoreEvent('FIRST-SNAP', opKey, { docsCount: snapshot.size }); // FIX: firestore instrumentation
                const reviews = snapshot.docs.map(d => ({id: d.id, ...d.data()}));
                setSellerReviews(reviews);
                if (reviews.length > 0) {
                    const total = reviews.reduce((acc, curr) => acc + curr.rating, 0);
                    setAvgRating((total / reviews.length).toFixed(1));
                } else {
                    setAvgRating(0);
                }
            }, (err) => {
                logListenerEvent(opKey, 'ERROR', { path: `artifacts/${appId}/public/data/reviews`, query: `sellerId == ${selectedProduct?.sellerId}`, rawError: err, code: err?.code, message: err?.message, stack: err?.stack, name: err?.name }, true);
                logFirestoreEvent('ERROR', opKey, { code: err?.code, message: err?.message }); // FIX: firestore instrumentation
                if (isInternalFirestoreError(err)) { // FIX: firestore instrumentation
                    blockFirestoreOp(opKey, 'internal-error', { path: `artifacts/${appId}/public/data/reviews`, query: `sellerId == ${selectedProduct?.sellerId}` }); // FIX: firestore instrumentation
                    setSellerReviews([]); // FIX: firestore instrumentation
                    setAvgRating(0); // FIX: firestore instrumentation
                    if (reviewsUnsubRef.current) { reviewsUnsubRef.current(); reviewsUnsubRef.current = null; } // FIX: firestore instrumentation
                    return; // FIX: firestore instrumentation
                }
                if (err?.code === 'permission-denied') {
                    markDeniedOp(opKey, { type: 'LISTEN', path: `artifacts/${appId}/public/data/reviews`, query: `sellerId == ${selectedProduct?.sellerId}` }); // FIX: permissions
                    setSellerReviews([]);
                    setAvgRating(0);
                    if (reviewsUnsubRef.current) { reviewsUnsubRef.current(); reviewsUnsubRef.current = null; } // FIX: permissions
                    return;
                }
                if (err?.code === 'cancelled' || err?.code === 'unavailable') return; // FIX: watch stream
                console.error("Seller reviews error", err);
            }); // FIX: watch stream
            reviewsUnsubRef.current = () => {
                logListenerEvent(opKey, 'UNSUBSCRIBE', { path: `artifacts/${appId}/public/data/reviews`, query: `sellerId == ${selectedProduct?.sellerId}` });
                reviewsUnsub();
            };
        } catch (subscribeError) {
            logListenerEvent(opKey, 'ERROR', { path: `artifacts/${appId}/public/data/reviews`, query: `sellerId == ${selectedProduct?.sellerId}`, reason: 'subscribe-failed', rawError: subscribeError }, true);
        }
        
        return () => {
            if (reviewsUnsubRef.current) {
                reviewsUnsubRef.current();
                reviewsUnsubRef.current = null;
            }
        }; // FIX: watch stream
    }, [db, selectedProduct?.sellerId, authReady, user?.uid, markDeniedOp, logFirestoreEvent, blockFirestoreOp, isInternalFirestoreError, logListenerEvent]); // FIX: watch stream

    if (!selectedProduct) return null;

    return (
        <div className="pb-24 animate-fade-in">
            <div className="bg-slate-900 sticky top-16 z-10 px-4 py-2 flex items-center gap-2 border-b border-slate-800">
                <button onClick={() => setView('home')} className="p-2 hover:bg-slate-800 rounded-full"><ChevronLeft /></button>
                <span className="font-bold">Details</span>
            </div>
            <div className="max-w-4xl mx-auto p-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="rounded-xl overflow-hidden bg-black border border-slate-800 h-fit">
                         <img src={selectedProduct.images?.[0] || 'https://via.placeholder.com/600/1e293b/FFFFFF?text=No+Image'} className="w-full object-contain max-h-[500px]" alt={selectedProduct.title} />
                    </div>
                    <div className="space-y-6">
                        <div>
                            <div className="flex justify-between items-start">
                                <h1 className="text-2xl font-bold text-white mb-2">{selectedProduct.title}</h1>
                                <button onClick={(e) => toggleFavorite(e, selectedProduct.id)} className="p-2 bg-slate-800 rounded-full">
                                    <Heart className={favorites.has(selectedProduct.id) ? "fill-red-500 text-red-500" : "text-gray-400"} />
                                </button>
                            </div>
                            <div className="text-3xl font-black text-cyan-400">{formatCurrency(selectedProduct.price)}</div>
                            <div className="flex items-center gap-4 mt-2 text-sm text-gray-400">
                                <span className="flex items-center gap-1"><MapPin size={14}/> {selectedProduct.location}</span>
                                <span className="flex items-center gap-1"><Tag size={14}/> {selectedProduct.condition}</span>
                                <span className="flex items-center gap-1"><ShieldCheck size={14}/> {selectedProduct.warranty || 'No Warranty'}</span>
                            </div>
                        </div>

                        {/* Seller Info & Reputation */}
                        <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-12 h-12 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-full flex items-center justify-center font-bold text-white text-lg">
                                    {selectedProduct.sellerName?.[0]}
                                </div>
                                <div>
                                    <div className="font-bold text-white text-lg">{selectedProduct.sellerName}</div>
                                    <div className="flex items-center gap-2 text-sm">
                                        <div className="flex items-center text-yellow-400 font-bold">
                                            <Star size={14} className="fill-current mr-1"/> {avgRating > 0 ? avgRating : 'New'}
                                        </div>
                                        <span className="text-gray-500">• {sellerReviews.length} reviews</span>
                                    </div>
                                </div>
                                <button onClick={() => startChat(selectedProduct.sellerId, selectedProduct.title)} className="ml-auto border border-cyan-500 text-cyan-500 px-4 py-2 rounded-lg text-sm font-bold hover:bg-cyan-500/10 transition-colors">
                                    Chat
                                </button>
                            </div>
                        </div>

                        <div>
                            <h3 className="text-lg font-bold text-white mb-2">Description</h3>
                            <p className="text-gray-300 whitespace-pre-wrap">{selectedProduct.description}</p>
                        </div>

                        {selectedProduct.specs && (
                             <div>
                                <h3 className="text-lg font-bold text-white mb-2">Specifications</h3>
                                <div className="grid grid-cols-2 gap-2">
                                    {Object.entries(selectedProduct.specs).map(([key, val]) => (
                                        <div key={key} className="bg-slate-800 p-2 rounded border border-slate-700">
                                            <span className="text-gray-500 text-xs uppercase block">{key}</span>
                                            <span className="text-white font-medium">{val}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Reviews Section */}
                        {sellerReviews.length > 0 && (
                            <div className="pt-4 border-t border-slate-800">
                                <h3 className="text-lg font-bold text-white mb-4">Seller Reviews</h3>
                                <div className="space-y-4">
                                    {sellerReviews.map(review => (
                                        <div key={review.id} className="bg-slate-800/50 p-3 rounded-lg border border-slate-800">
                                            <div className="flex justify-between items-start mb-1">
                                                <span className="font-bold text-white text-sm">{review.buyerName}</span>
                                                <span className="text-xs text-gray-500">{review.createdAt?.seconds ? new Date(review.createdAt.seconds * 1000).toLocaleDateString() : 'Recent'}</span>
                                            </div>
                                            <div className="flex mb-2">
                                                <StarRating rating={review.rating} readOnly size={12} />
                                            </div>
                                            <p className="text-gray-300 text-sm">{review.comment}</p>
                                            <div className="text-xs text-gray-600 mt-2">Purchased: {review.productTitle}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                        
                        <div className="fixed bottom-0 left-0 right-0 p-4 bg-slate-900 border-t border-slate-800 md:static md:bg-transparent md:border-0 md:p-0 z-50">
                            <div className="flex gap-2 max-w-4xl mx-auto">
                                <button onClick={() => startChat(selectedProduct.sellerId, selectedProduct.title)} className="flex-1 py-3 bg-slate-800 text-white font-bold rounded-lg border border-slate-700 hover:bg-slate-700">
                                    Chat Now
                                </button>
                                <button onClick={() => handleAddToCart(selectedProduct)} className="flex-1 py-3 bg-cyan-600 text-white font-bold rounded-lg hover:bg-cyan-500 shadow-lg shadow-cyan-600/20">
                                    Add to Cart
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
  };

  const CartView = () => {
    const total = cart.reduce((acc, item) => acc + (item.price * item.qty), 0);
    return (
        <div className="max-w-2xl mx-auto p-4 pb-24">
            <h1 className="text-2xl font-bold mb-6 flex items-center gap-2"><ShoppingCart className="text-cyan-400"/> My Cart</h1>
            {cart.length === 0 ? (
                <div className="text-center py-10 text-gray-500">Your cart is empty.</div>
            ) : (
                <div className="space-y-4">
                    {cart.map(item => (
                        <div key={item.id} className="bg-slate-800 p-4 rounded-lg flex items-center gap-4 border border-slate-700">
                            <img src={item.images?.[0]} className="w-16 h-16 object-cover rounded bg-slate-900" />
                            <div className="flex-1">
                                <h3 className="font-bold text-white line-clamp-1">{item.title}</h3>
                                <div className="text-cyan-400">{formatCurrency(item.price)}</div>
                            </div>
                            <div className="flex items-center gap-3">
                                <span className="text-gray-400">x{item.qty}</span>
                                <button onClick={() => removeFromCart(item.id)} className="text-red-400 hover:text-red-300"><Trash2 size={18}/></button>
                            </div>
                        </div>
                    ))}
                    <div className="border-t border-slate-700 pt-4 mt-4">
                        <div className="flex justify-between text-xl font-bold text-white mb-4">
                            <span>Total</span>
                            <span>{formatCurrency(total)}</span>
                        </div>
                        <button onClick={contactSellerFromCart} className="w-full py-3 bg-green-600 hover:bg-green-500 text-white font-bold rounded shadow-lg shadow-green-600/20">
                            Proceed to Checkout
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
  };

  const ChatView = () => {
    const [msgText, setMsgText] = useState('');
    
    // In a real app, this would use Firestore listeners
    const messages = activeChat ? activeChat.messages : [];
    
    const sendMsg = () => {
        if(!msgText.trim()) return;
        // Mock send
        activeChat.messages.push({sender: 'Me', text: msgText});
        setMsgText('');
    };

    if (!activeChat) return <div className="p-8 text-center text-gray-500">Select a chat to start messaging</div>;

    return (
        <div className="flex flex-col h-[calc(100vh-64px)] pb-16">
             <div className="bg-slate-800 p-4 border-b border-slate-700 flex items-center gap-2">
                 <button onClick={() => setView('home')} className="md:hidden"><ChevronLeft/></button>
                 <div>
                     <div className="font-bold text-white">{activeChat.subject}</div>
                     <div className="text-xs text-green-400">Online</div>
                 </div>
             </div>
             <div className="flex-1 overflow-y-auto p-4 space-y-3">
                 {messages.map((m, i) => (
                     <div key={i} className={`flex ${m.sender === 'Me' ? 'justify-end' : 'justify-start'}`}>
                         <div className={`max-w-[80%] p-3 rounded-lg text-sm ${m.sender === 'Me' ? 'bg-cyan-600 text-white rounded-br-none' : 'bg-slate-700 text-gray-200 rounded-bl-none'}`}>
                             {m.text}
                         </div>
                     </div>
                 ))}
             </div>
             <div className="p-3 bg-slate-800 border-t border-slate-700 flex gap-2">
                 <input 
                    className="flex-1 bg-slate-900 border border-slate-600 rounded-full px-4 py-2 text-white focus:border-cyan-500 outline-none"
                    placeholder="Type a message..."
                    value={msgText}
                    onChange={e => setMsgText(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && sendMsg()}
                 />
                 <button onClick={sendMsg} className="p-2 bg-cyan-600 rounded-full text-white"><Send size={20}/></button>
             </div>
        </div>
    );
  };

  const ProfileView = () => {
      // ===== PROFILE SETTINGS START =====
      const profilePhotoURL = profileForm.photoURL || user?.photoURL || null; // DATA-ONLY
      const isUserDeactivated = !!profileForm.isDeactivated; // DATA-ONLY
      // ===== PROFILE SETTINGS END =====
      
      const userDeals = useMemo(() => {
        if (!user || cart.length === 0) return [];
        return cart.map((item, index) => ({
          id: `${item.id || index}-deal`,
          statusLabel: 'Chat to arrange',
          total: (item.price || 0) * (item.qty || 1),
          items: [item],
        }));
      }, [cart, user]);

      if (!user) return <AuthView mode="login" />;
      const isAnonViewer = authReady && user?.isAnonymous; // DATA-ONLY

      return (
          <div className="max-w-2xl mx-auto p-4 pb-24">
              {/* ===== PROFILE SETTINGS START ===== */}
              <div className="bg-slate-800 p-6 rounded-lg border border-slate-700 mb-6 flex flex-col gap-4 md:flex-row md:items-center">
                  <div className="flex items-center gap-4">
                      <div className="w-20 h-20 rounded-full border-2 border-cyan-500/50 overflow-hidden bg-slate-900 flex items-center justify-center text-2xl font-bold text-white">
                          {profilePhotoURL ? (
                              <img src={profilePhotoURL} alt="Profile" className="w-full h-full object-cover" />
                          ) : (
                              (user.displayName?.[0]?.toUpperCase() || 'U')
                          )}
                      </div>
                      <div>
                          <div className="flex flex-wrap items-center gap-2">
                              <h2 className="text-xl font-bold text-white">{profileForm.displayName || user.displayName || 'User'}</h2>
                              {userBadge === 'RIGX Founder' && (
                                <span className={`text-xs font-semibold tracking-[0.3em] uppercase px-3 py-1 rounded-full bg-gradient-to-r from-amber-400 via-pink-500 to-purple-600 text-slate-900 shadow-lg shadow-amber-500/40 border border-white/20 ${prefersReducedMotion ? '' : 'animate-pulse'}`}>RIGX Founder</span> // UI-ONLY: badge
                              )}
                              {userBadge === 'RIGX Pioneer' && (
                                <span className={`text-xs font-semibold tracking-[0.3em] uppercase px-3 py-1 rounded-full bg-cyan-500/20 text-cyan-200 border border-cyan-400/40 shadow shadow-cyan-500/30 ${prefersReducedMotion ? '' : 'animate-pulse'}`}>RIGX Pioneer</span> // UI-ONLY: badge
                              )}
                          </div>
                          <p className="text-gray-400 text-sm">{user.email}</p>
                          {isUserDeactivated && (
                            <p className="text-xs text-orange-400 mt-1">Account deactivated — limited actions available.</p>
                          )}
                          <div className="flex flex-wrap gap-3 mt-3">
                              <button onClick={() => setSettingsOpen(true)} className="text-sm px-4 py-2 rounded-full border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10 transition">Settings</button> {/* // UI-ONLY */}
                              <button onClick={() => signOut(auth)} className="text-sm px-4 py-2 rounded-full border border-red-500/40 text-red-400 hover:bg-red-500/10 flex items-center gap-1">
                                  <LogOut size={14}/> Sign Out
                              </button>
                          </div>
                      </div>
                  </div>
                  <div>
                      {profileForm.bio && (
                        <p className="text-sm text-gray-300 bg-slate-900/60 border border-slate-700 rounded-lg p-3">{profileForm.bio}</p>
                      )}
                  </div>
              </div>
              {/* ===== PROFILE SETTINGS END ===== */}

              <h3 className="font-bold text-white mb-4 flex items-center gap-2"><Package className="text-cyan-400"/> My Deals</h3>
              {isAnonViewer ? (
                <p className="text-center text-sm text-gray-400 bg-slate-800/70 border border-slate-700 rounded-lg py-6">
                  Sign in to save listings and manage chats with sellers.
                </p>
              ) : (
              <div className="space-y-3">
                  {userDeals.map(order => (
                      <div key={order.id} className="bg-slate-800 p-4 rounded-lg border border-slate-700">
                          <div className="flex justify-between items-start mb-2">
                              <span className="text-xs text-gray-500">Listing: {order.id.slice(0,8)}</span>
                              <span className="text-xs bg-orange-500/20 text-orange-400 px-2 py-1 rounded">{order.statusLabel}</span>
                          </div>
                          {order.items.map((item, idx) => (
                              <div key={idx} className="flex gap-4 mb-3 items-center bg-slate-900/50 p-2 rounded">
                                  <div className="w-12 h-12 bg-slate-800 rounded flex items-center justify-center text-gray-600">
                                      {item.images?.[0] ? <img src={item.images[0]} className="w-full h-full object-cover rounded"/> : <Package size={20}/>}
                                  </div>
                                  <div className="flex-1">
                                      <div className="text-white text-sm font-bold line-clamp-1">{item.title}</div>
                                      <div className="text-gray-400 text-xs">Qty: {item.qty} • {formatCurrency(item.price)}</div>
                                  </div>
                                  {/* Rate Button */}
                                  {item.sellerId && item.sellerId !== user.uid && (
                                      <button 
                                          onClick={() => {
                                             setReviewTarget({ 
                                                  sellerId: item.sellerId, 
                                                  itemId: item.id,
                                                  itemTitle: item.title,
                                                  orderId: order.id 
                                              });
                                              setReviewModalOpen(true);
                                          }}
                                          className="text-xs bg-cyan-600/20 hover:bg-cyan-600/40 text-cyan-400 border border-cyan-600/50 px-3 py-1.5 rounded-full transition-colors font-medium flex items-center gap-1"
                                      >
                                          <Star size={12}/> Rate Seller
                                      </button>
                                  )}
                              </div>
                          ))}
                          <div className="border-t border-slate-700 pt-2 flex justify-between items-center mt-2">
                              <span className="text-sm text-gray-400">Listing Value:</span>
                              <span className="font-bold text-white">{formatCurrency(order.total)}</span>
                          </div>
                      </div>
                  ))}
                  {userDeals.length === 0 && <p className="text-gray-500 text-center py-4">Save listings to track deals you are chatting about.</p>}
              </div>
              )}
          </div>
      );
  };

  const SellerDashboard = () => {
    const listingsUnsubRef = useRef(null); // FIX: permissions root cause
    const listingsDisabledRef = useRef(false); // FIX: permissions root cause
    const listenerGenRef = useRef(0); // FIX: unsub assertion
    const cleanupWarnedRef = useRef({ listings: false, sales: false }); // FIX: unsub assertion
    const dashPermLogRef = useRef(new Set()); // FIX: dash perm

    const logDashPermOnce = useCallback((opKey, payload) => { // FIX: dash perm
        if (dashPermLogRef.current.has(opKey)) return; // FIX: dash perm
        dashPermLogRef.current.add(opKey); // FIX: dash perm
        console.warn('[DASH-PERM]', opKey, {
            ...payload,
            uid: user?.uid || null,
            email: user?.email || null,
            authReady,
            isAnonymous: !!user?.isAnonymous,
        }); // FIX: dash perm
    }, [authReady, user]); // FIX: dash perm

    const makeOnceUnsub = (unsub, label, listenerId, meta = {}) => { // FIX: unsub assertion
        let called = false; // FIX: unsub assertion
        return () => { // FIX: unsub assertion
            if (called || !unsub) return; // FIX: unsub assertion
            called = true; // FIX: unsub assertion
            try { // FIX: unsub assertion
                logListenerEvent(listenerId, 'UNSUBSCRIBE', { ...meta, reason: label }); // FIX: listen instrumentation
                unsub(); // FIX: unsub assertion
            } catch (err) { // FIX: unsub assertion
                if (!cleanupWarnedRef.current[label]) { // FIX: unsub assertion
                    cleanupWarnedRef.current[label] = true; // FIX: unsub assertion
                    console.warn('SellerDashboard: listener cleanup failed (suppressed)', err); // FIX: unsub assertion
                } // FIX: unsub assertion
            } // FIX: unsub assertion
        }; // FIX: unsub assertion
    }; // FIX: unsub assertion

    const runImmediateCleanup = (ref) => { // FIX: unsub assertion
        if (ref.current?.fn) { // FIX: unsub assertion
            ref.current.fn(); // FIX: unsub assertion
            ref.current = null; // FIX: unsub assertion
        } // FIX: unsub assertion
    }; // FIX: unsub assertion

    useEffect(() => {
        listingsDisabledRef.current = false; // FIX: permissions root cause
    }, [user?.uid]); // FIX: permissions root cause

    useEffect(() => {
        if (listingsUnsubRef.current?.fn) { // FIX: firestore instrumentation
            listingsUnsubRef.current.fn(); // FIX: firestore instrumentation
            listingsUnsubRef.current = null; // FIX: firestore instrumentation
        } // FIX: permissions root cause
        const currentGen = ++listenerGenRef.current; // FIX: unsub assertion
        runImmediateCleanup(listingsUnsubRef); // FIX: unsub assertion

        const listingsOpKey = 'LISTEN:sellerListings'; // FIX: permissions

        if (!authReady || configError || !db || !user?.uid || isAnonymousUser) {
            setMyListings([]); // FIX: permissions root cause
            return () => {}; // FIX: unsub assertion
        }
        const wantListings = !listingsDisabledRef.current && !deniedOpsRef.current.has(listingsOpKey); // FIX: permissions
        if (!wantListings) return; // FIX: permissions root cause

        const handleListenerError = (err, type, opKey, targetPath, querySummary) => { // FIX: permissions root cause
            logFirestoreEvent('ERROR', opKey, { code: err?.code, message: err?.message }); // FIX: firestore instrumentation
            if (isInternalFirestoreError(err)) { // FIX: firestore instrumentation
                logFirestoreEvent('INTERNAL', opKey, { message: err?.message, path: targetPath, query: querySummary }); // FIX: firestore instrumentation
                blockFirestoreOp(opKey, 'internal-error', { path: targetPath, query: querySummary }); // FIX: firestore instrumentation
                listingsDisabledRef.current = true;
                setMyListings([]);
                runImmediateCleanup(listingsUnsubRef); // FIX: firestore instrumentation
                console.warn(`Seller ${type} listener disabled`, err?.code || err?.message); // FIX: firestore instrumentation
                return true; // FIX: firestore instrumentation
            }
            if (err?.code === 'permission-denied' || err?.code === 'cancelled' || err?.code === 'unavailable' || err?.message?.includes('INTERNAL ASSERTION FAILED')) {
                if (err?.code === 'permission-denied') { // FIX: permissions
                    const summary = type === 'listings'
                      ? `where(sellerId == ${user?.uid})`
                      : `users/${user?.uid}/sales subcollection (all docs)`; // FIX: dash perm
                    logDashPermOnce(opKey, { type: 'LISTEN', path: targetPath, querySummary: summary }); // FIX: dash perm
                    markDeniedOp(opKey, { type: 'LISTEN', path: targetPath, query: summary }); // FIX: permissions
                }
                listingsDisabledRef.current = true;
                setMyListings([]);
                runImmediateCleanup(listingsUnsubRef); // FIX: unsub assertion
                console.warn(`Seller ${type} listener disabled`, err?.code || err?.message); // FIX: permissions root cause
                return true;
            }
            console.error(`Seller ${type} listener error`, err); // FIX: permissions root cause
            return false;
        };

        try {
            if (wantListings) {
                const productsQuery = query(
                    collection(db, 'artifacts', appId, 'public', 'data', 'products'),
                    where('sellerId', '==', user.uid)
                ); // FIX: permissions root cause
                logFirestoreEvent('START', listingsOpKey, { type: 'LISTEN', path: `artifacts/${appId}/public/data/products`, query: `where(sellerId == ${user.uid})` }); // FIX: firestore instrumentation
                logListenerEvent(listingsOpKey, 'SUBSCRIBE', { path: `artifacts/${appId}/public/data/products`, query: `where(sellerId == ${user.uid})` });
                const unsub = onSnapshot(productsQuery, (snap) => {
                    logFirestoreEvent('FIRST-SNAP', listingsOpKey, { docsCount: snap.size }); // FIX: firestore instrumentation
                    if (listingsDisabledRef.current) return; // FIX: permissions root cause
                    setMyListings(snap.docs.map(d => ({id: d.id, ...d.data()}))); // FIX: permissions root cause
                }, (err) => {
                    logListenerEvent(listingsOpKey, 'ERROR', { path: `artifacts/${appId}/public/data/products`, query: `where(sellerId == ${user?.uid})`, rawError: err, code: err?.code, message: err?.message, stack: err?.stack, name: err?.name }, true);
                    handleListenerError(err, 'listings', listingsOpKey, `artifacts/${appId}/public/data/products`, `where(sellerId == ${user?.uid})`); // FIX: permissions root cause
                }); // FIX: unsub assertion
                listingsUnsubRef.current = { gen: currentGen, fn: makeOnceUnsub(unsub, 'listings', listingsOpKey, { path: `artifacts/${appId}/public/data/products`, query: `where(sellerId == ${user.uid})` }) }; // FIX: unsub assertion
            }

        } catch (err) {
            console.error("Seller dashboard data error", err); // FIX: permissions root cause
        }

        return () => {
            if (listingsUnsubRef.current?.gen === currentGen) { // FIX: unsub assertion
                listingsUnsubRef.current.fn(); // FIX: unsub assertion
                listingsUnsubRef.current = null; // FIX: unsub assertion
            } // FIX: unsub assertion
        }; // FIX: permissions root cause
    }, [authReady, configError, db, user?.uid, isAnonymousUser, markDeniedOp, logFirestoreEvent, blockFirestoreOp, isInternalFirestoreError, logListenerEvent]); // FIX: permissions root cause

    const inventoryValue = myListings.reduce((sum, item) => sum + (item.price || 0), 0);
    const pendingChats = activeChat ? 1 : 0;

    const generateAWB = () => {
        showToast("Coordinate shipping details directly in chat with your buyer.", "success");
    };

    return (
        <div className="max-w-7xl mx-auto px-4 py-8 pb-24 text-gray-200">
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                    <TrendingUp className="text-cyan-400"/> Seller Dashboard
                </h1>
                <button onClick={() => setView('sell')} className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded text-white font-bold flex items-center gap-2">
                    <PlusCircle size={18}/> New Listing
                </button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
                    <div className="text-gray-400 text-sm mb-1">Inventory Value</div>
                    <div className="text-2xl font-bold text-white">{formatCurrency(inventoryValue)}</div>
                </div>
                <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
                    <div className="text-gray-400 text-sm mb-1">Chats To Reply</div>
                    <div className="text-2xl font-bold text-orange-400">{pendingChats}</div>
                </div>
                <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
                    <div className="text-gray-400 text-sm mb-1">Active Listings</div>
                    <div className="text-2xl font-bold text-cyan-400">{myListings.length}</div>
                </div>
            </div>

            {/* Sales Table */}
            <h2 className="text-xl font-bold text-white mb-4">Chat Deals Overview</h2>
            <div className="bg-slate-800 rounded-lg overflow-hidden border border-slate-700 mb-8">
                {mySales.length === 0 ? (
                    <div className="p-8 text-center text-gray-500">No tracked deals yet. Reply to chats to arrange transactions.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs text-gray-400 uppercase bg-slate-900">
                                <tr>
                                    <th className="px-6 py-3">Product</th>
                                    <th className="px-6 py-3">Buyer</th>
                                    <th className="px-6 py-3">Next Step</th>
                                    <th className="px-6 py-3">Notes</th>
                                    <th className="px-6 py-3">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {mySales.map(sale => (
                                    <tr key={sale.id} className="border-b border-slate-700">
                                        <td className="px-6 py-4 font-medium text-white">{sale.title} (x{sale.qty})</td>
                                        <td className="px-6 py-4">{sale.buyerName}</td>
                                        <td className="px-6 py-4">
                                            <span className="bg-orange-500/20 text-orange-400 px-2 py-1 rounded text-xs">{sale.status}</span>
                                        </td>
                                        <td className="px-6 py-4">{sale.courier || 'PosLaju'}</td>
                                        <td className="px-6 py-4">
                                            <button onClick={generateAWB} className="text-cyan-400 hover:underline flex items-center gap-1">
                                                <MessageSquare size={14}/> Message Buyer
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <h2 className="text-xl font-bold text-white mb-4">My Listings</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {myListings.map(item => (
                    <div key={item.id} className="bg-slate-800 p-3 rounded-lg border border-slate-700">
                        <img src={item.images?.[0]} className="w-full h-32 object-cover rounded bg-slate-900 mb-2" />
                        <div className="font-bold text-white line-clamp-1">{item.title}</div>
                        <div className="text-cyan-400 font-bold">{formatCurrency(item.price)}</div>
                        <button className="w-full mt-2 py-1 bg-slate-700 hover:bg-slate-600 rounded text-xs">Edit</button>
                        {/* ===== HOT BUMP START ===== */}
                        {user?.uid && (
                          <button
                            className={`w-full mt-2 py-1 rounded text-xs font-semibold transition ${sellerHotBumpCount >= 2 || (item.hotBumpDayKey === (sellerHotBumpDayKey || formatKLDayKey()) && item.hotBumpBy === user.uid) ? 'bg-slate-700 text-gray-400 cursor-not-allowed' : 'bg-gradient-to-r from-amber-500 to-pink-500 text-slate-900 hover:opacity-90'}`}
                            onClick={() => handleHotBump(item)}
                            disabled={sellerHotBumpCount >= 2 || (item.hotBumpDayKey === (sellerHotBumpDayKey || formatKLDayKey()) && item.hotBumpBy === user.uid) || hotBumpLoadingId === item.id}
                          >
                            {hotBumpLoadingId === item.id ? 'Bumping...' : 'Bump to Hot Item'}
                          </button>
                        )}
                        {/* ===== HOT BUMP END ===== */}
                    </div>
                ))}
            </div>
        </div>
    );
  };

  // NEW: Community View
  const CommunityView = () => {
    const [posts, setPosts] = useState([]);
    const [newPost, setNewPost] = useState('');

    const postsUnsubRef = useRef(null); // FIX: watch stream
    useEffect(() => { // FIX: watch stream
      const opKey = 'LISTEN:communityPosts'; // FIX: permissions
      if (postsUnsubRef.current) {
        postsUnsubRef.current();
        postsUnsubRef.current = null;
      } // FIX: watch stream
      if (!authReady || !user?.uid) {
        setPosts([]);
        return;
      }
      if (deniedOpsRef.current.has(opKey) || configError || !db) { // FIX: permissions
        if (!user?.uid) setPosts([]); // FIX: permissions
        return;
      } // FIX: watch stream
      try {
        const q = query(
            collection(db, 'artifacts', appId, 'public', 'data', 'community_posts'),
            orderBy('createdAt', 'desc'),
            limit(50)
        ); // FIX: watch stream
        logFirestoreEvent('START', opKey, { type: 'LISTEN', path: `artifacts/${appId}/public/data/community_posts`, query: 'orderBy createdAt desc limit 50' }); // FIX: firestore instrumentation
        logListenerEvent(opKey, 'SUBSCRIBE', { path: `artifacts/${appId}/public/data/community_posts`, query: 'orderBy createdAt desc limit 50' });
        const postsUnsub = onSnapshot(q, (snapshot) => {
            logFirestoreEvent('FIRST-SNAP', opKey, { docsCount: snapshot.size }); // FIX: firestore instrumentation
            setPosts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        }, (err) => {
            logListenerEvent(opKey, 'ERROR', { path: `artifacts/${appId}/public/data/community_posts`, query: 'orderBy createdAt desc limit 50', rawError: err, code: err?.code, message: err?.message, stack: err?.stack, name: err?.name }, true);
            logFirestoreEvent('ERROR', opKey, { code: err?.code, message: err?.message }); // FIX: firestore instrumentation
            if (isInternalFirestoreError(err)) { // FIX: firestore instrumentation
                blockFirestoreOp(opKey, 'internal-error', { path: `artifacts/${appId}/public/data/community_posts`, query: 'orderBy createdAt desc limit 50' }); // FIX: firestore instrumentation
                setPosts([]); // FIX: firestore instrumentation
                if (postsUnsubRef.current) { postsUnsubRef.current(); postsUnsubRef.current = null; } // FIX: firestore instrumentation
                return; // FIX: firestore instrumentation
            }
            if (err?.code === 'permission-denied') {
                markDeniedOp(opKey, { type: 'LISTEN', path: `artifacts/${appId}/public/data/community_posts`, query: 'latest 50 desc' }); // FIX: permissions
                setPosts([]);
                if (postsUnsubRef.current) { postsUnsubRef.current(); postsUnsubRef.current = null; } // FIX: permissions
                return;
            }
            if (err?.code === 'cancelled' || err?.code === 'unavailable') return; // FIX: watch stream
            console.error("Community posts listener error", err);
        }); // FIX: watch stream
        postsUnsubRef.current = () => {
            logListenerEvent(opKey, 'UNSUBSCRIBE', { path: `artifacts/${appId}/public/data/community_posts`, query: 'orderBy createdAt desc limit 50' });
            postsUnsub();
        };
      } catch (e) {
        console.log("Firestore error", e);
      }
      return () => {
        if (postsUnsubRef.current) {
            postsUnsubRef.current();
            postsUnsubRef.current = null;
        }
      }; // FIX: watch stream
    }, [configError, db, authReady, user?.uid, markDeniedOp, logFirestoreEvent, blockFirestoreOp, isInternalFirestoreError, logListenerEvent]); // FIX: watch stream

    const handlePost = async () => {
        if (!authReady || !user?.uid || user.isAnonymous) {
            showToast("Please login to post", "error");
            setView('login');
            return;
        }
        if (!newPost.trim()) return;

        try {
            await runFirestoreOp('WRITE:communityPost', 'WRITE', `artifacts/${appId}/public/data/community_posts`, 'addDoc post', () => addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'community_posts'), {
                content: newPost,
                authorId: user.uid,
                authorName: user.displayName || 'Anonymous User',
                createdAt: serverTimestamp(),
                likes: 0
            }));
            setNewPost('');
            showToast("Posted to community!");
        } catch (e) {
            showToast("Failed to post", "error");
        }
    };

    // ===== COMMUNITY UI START (GAMING) ===== // UI-ONLY
    return (
        <div className="relative max-w-4xl mx-auto px-4 py-8 pb-24"> {/* // UI-ONLY */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none" aria-hidden="true"> {/* // UI-ONLY: center background box */}
                <div className="community-grid w-full h-full rounded-[40px] opacity-80"></div> {/* // UI-ONLY: center background box */}
            </div>
            <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 via-transparent to-purple-600/10 blur-3xl" aria-hidden="true"></div> {/* // UI-ONLY */}
            <div className="relative z-10 space-y-6"> {/* // UI-ONLY */}
                <div className="flex items-center justify-between gap-4"> {/* // UI-ONLY */}
                    <h1 className="text-3xl font-black tracking-tight text-white flex items-center gap-3"> {/* // UI-ONLY */}
                        <Users className="text-cyan-400" /> {/* // UI-ONLY */}
                        RIGX Community {/* // UI-ONLY */}
                    </h1>
                    <span className="text-xs uppercase tracking-[0.4em] text-cyan-200/70">Stay Connected</span> {/* // UI-ONLY */}
                </div>

                <div className="community-card rounded-[28px] border border-white/10 bg-[#050910]/90 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.5)]"> {/* // UI-ONLY */}
                    <p className="text-sm text-cyan-100/70 mb-4">Share your builds, ask for tuning tips, or drop the latest tech gossip.</p> {/* // UI-ONLY */}
                    <div className="rounded-2xl border border-white/5 bg-black/30 p-3 mb-4"> {/* // UI-ONLY */}
                        <textarea
                            className="w-full bg-transparent text-white rounded-xl border border-transparent focus:border-cyan-500/60 focus:ring-0 placeholder-gray-500 p-3 resize-none"
                            rows="3"
                            placeholder="Ask for build advice, share your rig, or discuss tech..." // UI-ONLY
                            value={newPost}
                            onChange={(e) => setNewPost(e.target.value)}
                        />
                    </div>
                    <div className="flex justify-between items-center text-xs text-gray-500"> {/* // UI-ONLY */}
                        <span>Community rules: be respectful, no spam.</span> {/* // UI-ONLY */}
                        <button 
                            onClick={handlePost}
                            className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-500 px-5 py-2 text-sm font-bold text-white shadow-lg shadow-cyan-500/25 transition hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                        >
                            <span className="relative z-10 flex items-center gap-2"><Send size={16} /> Post</span> {/* // UI-ONLY */}
                        </button>
                    </div>
                </div>

                <div className="space-y-4"> {/* // UI-ONLY */}
                    {posts.map(post => (
                        <div key={post.id} className="community-post rounded-3xl border border-white/10 bg-gradient-to-r from-[#050b16]/90 to-[#070c1a]/95 p-5 shadow-lg shadow-cyan-500/5"> {/* // UI-ONLY */}
                            <div className="flex items-start justify-between mb-3"> {/* // UI-ONLY */}
                                <div className="flex items-center gap-3"> {/* // UI-ONLY */}
                                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-cyan-500 flex items-center justify-center text-sm font-bold text-white shadow-lg shadow-purple-500/30"> {/* // UI-ONLY */}
                                        {post.authorName?.[0]?.toUpperCase() || 'U'}
                                    </div>
                                    <div>
                                        <p className="font-semibold text-white text-sm">{post.authorName}</p> {/* // UI-ONLY */}
                                        <p className="text-xs text-cyan-200/70">
                                            {post.createdAt?.seconds ? new Date(post.createdAt.seconds * 1000).toLocaleDateString() : 'Just now'}
                                        </p>
                                    </div>
                                </div>
                                <div className="text-[10px] uppercase tracking-[0.3em] text-gray-500">RigX</div> {/* // UI-ONLY */}
                            </div>
                            <p className="text-gray-200 text-sm whitespace-pre-wrap leading-relaxed">{post.content}</p> {/* // UI-ONLY */}
                        </div>
                    ))}
                    {posts.length === 0 && (
                        <div className="community-post text-center text-gray-400 py-12 rounded-3xl border border-dashed border-white/10 bg-[#050b16]/60">
                            No posts yet. Be the first to start a discussion! {/* // UI-ONLY */}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
    // ===== COMMUNITY UI END (GAMING) ===== // UI-ONLY
  };

  const SellView = () => {
    if (!user || user.isAnonymous) return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
        <LogOut size={48} className="text-gray-500 mb-4" />
        <h2 className="text-xl font-bold text-white mb-2">Login Required</h2>
        <p className="text-gray-400 mb-6">You need to register or login to sell items.</p>
        <button onClick={() => setView('login')} className="px-6 py-2 bg-cyan-600 text-white rounded font-bold">Login Now</button>
      </div>
    );

    const [form, setForm] = useState({
      title: '', price: '', category: 'gpu', condition: 'Used', description: '', location: 'Kuala Lumpur',
      brand: '', model: '', warranty: 'No', image: '', listingType: 'sale', lookingFor: ''
    });
    const [specs, setSpecs] = useState({});
    const [uploading, setUploading] = useState(false);

    const handleImageUpload = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      setUploading(true);
      try {
        const storageRef = ref(storage, `products/${user.uid}/${Date.now()}_${file.name}`);
        const snapshot = await uploadBytes(storageRef, file);
        const downloadURL = await getDownloadURL(snapshot.ref);
        
        setForm(prev => ({ ...prev, image: downloadURL }));
        showToast("Image uploaded successfully!", "success");
      } catch (error) {
        console.error("Upload failed", error);
        showToast("Upload failed. Make sure Storage is enabled in Firebase Console.", "error");
      } finally {
        setUploading(false);
      }
    };

    const handleSubmit = () => {
       handlePublishProduct({
         ...form,
         price: parseFloat(form.price),
         specs,
         images: [form.image || 'https://via.placeholder.com/400/1e293b/FFFFFF?text=No+Image']
       });
    };

    return (
      <div className="max-w-2xl mx-auto px-4 py-8 pb-24 text-gray-200">
        <h1 className="text-2xl font-bold text-white mb-6">List Item for Sale / Swap</h1>
        <div className="bg-slate-800 p-6 rounded-lg space-y-4 border border-slate-700">
          
          <div>
            <label className="block text-sm mb-1 text-gray-400">Listing Type</label>
            <div className="grid grid-cols-3 gap-2">
               {['sale', 'swap', 'both'].map(type => (
                 <button 
                   key={type}
                   onClick={() => setForm({...form, listingType: type})}
                   className={`py-2 rounded text-sm font-bold border ${form.listingType === type ? 'bg-cyan-600 border-cyan-500 text-white' : 'bg-slate-900 border-slate-600 text-gray-400'}`}
                 >
                   {type === 'sale' ? 'For Sale' : type === 'swap' ? 'Swap Only' : 'Sale & Swap'}
                 </button>
               ))}
            </div>
          </div>

          <div>
            <label className="block text-sm mb-1 text-gray-400">Item Title</label>
            <input type="text" className="w-full bg-slate-900 border border-slate-700 rounded p-2 focus:border-cyan-500 outline-none transition" value={form.title} onChange={e => setForm({...form, title: e.target.value})} placeholder="e.g. RTX 3060 12GB OC"/>
          </div>

          <div className="grid grid-cols-2 gap-4">
             <div>
                <label className="block text-sm mb-1 text-gray-400">Price / Value (RM)</label>
                <input type="number" className="w-full bg-slate-900 border border-slate-700 rounded p-2 focus:border-cyan-500 outline-none" value={form.price} onChange={e => setForm({...form, price: e.target.value})}/>
             </div>
             <div>
                <label className="block text-sm mb-1 text-gray-400">Condition</label>
                <select className="w-full bg-slate-900 border border-slate-700 rounded p-2 focus:border-cyan-500 outline-none" value={form.condition} onChange={e => setForm({...form, condition: e.target.value})}>
                  <option>New</option>
                  <option>Like New</option>
                  <option>Used</option>
                </select>
             </div>
          </div>

          {(form.listingType === 'swap' || form.listingType === 'both') && (
            <div className="bg-purple-900/20 p-4 rounded border border-purple-500/30">
               <label className="block text-sm mb-1 text-purple-300 font-bold">What are you looking for?</label>
               <input 
                 type="text" 
                 className="w-full bg-slate-900 border border-purple-500/50 rounded p-2 text-sm focus:border-purple-400 outline-none" 
                 placeholder="e.g. Looking for RTX 3070 (I add cash) or PS5"
                 value={form.lookingFor} 
                 onChange={e => setForm({...form, lookingFor: e.target.value})}
               />
            </div>
          )}

          <div>
            <label className="block text-sm mb-1 text-gray-400">Category</label>
            <select className="w-full bg-slate-900 border border-slate-700 rounded p-2 focus:border-cyan-500 outline-none" value={form.category} onChange={e => setForm({...form, category: e.target.value})}>
              {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
               <label className="block text-sm mb-1 text-gray-400">Brand</label>
               <input type="text" className="w-full bg-slate-900 border border-slate-700 rounded p-2 focus:border-cyan-500 outline-none" value={form.brand} onChange={e => setForm({...form, brand: e.target.value})}/>
            </div>
            <div>
               <label className="block text-sm mb-1 text-gray-400">Model</label>
               <input type="text" className="w-full bg-slate-900 border border-slate-700 rounded p-2 focus:border-cyan-500 outline-none" value={form.model} onChange={e => setForm({...form, model: e.target.value})}/>
            </div>
          </div>

          {/* Dynamic Specs */}
          {SPEC_FIELDS[form.category] && (
            <div className="bg-slate-900 p-4 rounded border border-slate-700">
               <h3 className="text-sm font-bold text-cyan-400 mb-2">{form.category.toUpperCase()} Specs</h3>
               <div className="grid grid-cols-2 gap-4">
                 {SPEC_FIELDS[form.category].map(field => (
                   <div key={field}>
                     <label className="block text-xs mb-1 text-gray-400">{field}</label>
                     <input 
                       type="text" 
                       className="w-full bg-slate-800 border border-slate-700 rounded p-1 text-sm focus:border-cyan-500 outline-none"
                       onChange={e => setSpecs({...specs, [field]: e.target.value})}
                     />
                   </div>
                 ))}
               </div>
            </div>
          )}

          <div>
            <label className="block text-sm mb-1 text-gray-400">Product Image</label>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-4">
                <label className={`flex items-center gap-2 px-4 py-2 rounded cursor-pointer transition-colors ${uploading ? 'bg-slate-700 text-gray-500 cursor-not-allowed' : 'bg-cyan-600 hover:bg-cyan-500 text-white'}`}>
                  <Upload size={20} />
                  <span>{uploading ? 'Uploading...' : 'Upload Photo'}</span>
                  <input 
                    type="file" 
                    accept="image/*" 
                    className="hidden" 
                    onChange={handleImageUpload} 
                    disabled={uploading}
                  />
                </label>
                {form.image && (
                  <div className="relative group">
                    <img src={form.image} alt="Preview" className="h-16 w-16 object-cover rounded border border-slate-600" />
                    <div className="absolute inset-0 bg-black/50 hidden group-hover:flex items-center justify-center text-xs text-white rounded cursor-pointer" onClick={() => setForm({...form, image: ''})}>
                      Remove
                    </div>
                  </div>
                )}
              </div>
              {!form.image && <p className="text-xs text-gray-500">Upload a clear photo of your item (Max 5MB)</p>}
            </div>
          </div>
          
          <div>
            <label className="block text-sm mb-1 text-gray-400">Description</label>
            <textarea className="w-full bg-slate-900 border border-slate-700 rounded p-2 focus:border-cyan-500 outline-none" rows="4" value={form.description} onChange={e => setForm({...form, description: e.target.value})}/>
          </div>
          
          <div>
            <label className="block text-sm mb-1 text-gray-400">Location (City)</label>
            <input type="text" className="w-full bg-slate-900 border border-slate-700 rounded p-2 focus:border-cyan-500 outline-none" value={form.location} onChange={e => setForm({...form, location: e.target.value})}/>
          </div>

          <button onClick={handleSubmit} className="w-full py-3 bg-cyan-600 text-white font-bold rounded hover:bg-cyan-500 transition-colors">
            Publish Listing
          </button>
        </div>
      </div>
    );
  };

  const RecommendedSection = () => {
    if (recommendedProducts.length === 0) return null;

    return (
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <ThumbsUp className="text-cyan-400" size={20} />
          <h2 className="text-xl font-bold text-white tracking-wide">Recommended For You</h2>
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
          {recommendedProducts.map(product => (
            <div 
              key={product.id} 
              onClick={() => { setSelectedProduct(product); setView('product'); }}
              className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden hover:border-cyan-500 transition-all cursor-pointer group shadow-md flex flex-col"
            >
              <div className="aspect-square bg-slate-900 relative overflow-hidden">
                 <img 
                  src={product.images?.[0] || 'https://via.placeholder.com/300/1e293b/FFFFFF?text=No+Image'} 
                  alt={product.title} 
                  className="w-full h-full object-cover"
                />
                <button 
                  onClick={(e) => toggleFavorite(e, product.id)}
                  className="absolute top-2 right-2 p-1.5 bg-slate-900/50 rounded-full hover:bg-slate-800 transition-colors"
                >
                  <Heart size={16} className={favorites.has(product.id) ? "fill-red-500 text-red-500" : "text-white"} />
                </button>
              </div>
              
              <div className="p-3 flex flex-col flex-1">
                <h3 className="text-white text-sm font-medium line-clamp-2 leading-tight mb-2 h-10">{product.title}</h3>
                
                <div className="mt-auto">
                    <div className="text-cyan-400 font-bold text-base mb-1">{formatCurrency(product.price)}</div>
                    <div className="flex justify-between items-end">
                       <span className="text-[10px] text-gray-400 truncate max-w-[60px]">{product.location}</span>
                       <div className="flex items-center gap-0.5 text-[10px] text-yellow-500">
                          <Star size={10} fill="currentColor"/> {product.rating || 'New'}
                       </div>
                    </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const Navbar = () => (
    <nav className="bg-slate-900 border-b border-slate-800 sticky top-0 z-40 shadow-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center cursor-pointer" onClick={() => setView('home')}>
            <span className="text-4xl font-black tracking-tighter text-white uppercase select-none">
              RIGX
            </span>
          </div>
          
          <div className="hidden md:flex flex-1 mx-8 relative">
            <input
              type="text"
              placeholder="Search GPU, CPU, RAM..."
              className="w-full bg-slate-800 text-gray-200 border border-slate-700 rounded-full py-2 px-10 focus:outline-none focus:ring-2 focus:ring-cyan-500 placeholder-slate-500"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)} // FIX: search input focus
              ref={desktopSearchRef} // FIX: search input focus
              onFocus={() => setActiveSearchField('desktop')} // FIX: search input focus
              onBlur={() => setActiveSearchField(null)} // FIX: search input focus
            />
            <Search className="absolute left-3 top-2.5 text-gray-400 h-5 w-5" />
          </div>

          <div className="flex items-center gap-4">
            <button className="relative p-2 text-gray-300 hover:text-white" onClick={() => setView('cart')}>
              <ShoppingCart className="h-6 w-6" />
              {cart.length > 0 && (
                <span className="absolute top-0 right-0 inline-flex items-center justify-center px-2 py-1 text-xs font-bold leading-none text-white transform translate-x-1/4 -translate-y-1/4 bg-red-600 rounded-full">
                  {cart.length}
                </span>
              )}
            </button>
            <button 
                onClick={() => setView('community')} 
                className="hidden md:block px-3 py-1 text-gray-300 hover:text-white text-sm font-medium border border-transparent hover:border-slate-700 rounded"
            >
                Community
            </button>
            {user && !user.isAnonymous ? (
               <div className="flex gap-2">
                 <button onClick={() => setView('seller-dashboard')} className="hidden md:block px-3 py-1 bg-slate-800 hover:bg-slate-700 rounded text-sm text-cyan-400 border border-slate-700">
                   Seller Portal
                 </button>
                 <button onClick={() => setView('profile')} className="p-2 text-gray-300 hover:text-white">
                   <User className="h-6 w-6" />
                 </button>
               </div>
            ) : (
              <button onClick={() => setView('login')} className="text-sm font-medium text-cyan-400 hover:text-cyan-300">
                Login
              </button>
            )}
          </div>
        </div>
        <div className="md:hidden pb-3">
           <input
              type="text"
              placeholder="Search..."
              className="w-full bg-slate-800 text-gray-200 border border-slate-700 rounded-lg py-2 px-4 focus:outline-none focus:ring-2 focus:ring-cyan-500"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)} // FIX: search input focus
              ref={mobileSearchRef} // FIX: search input focus
              onFocus={() => setActiveSearchField('mobile')} // FIX: search input focus
              onBlur={() => setActiveSearchField(null)} // FIX: search input focus
            />
        </div>
      </div>
    </nav>
  );

  const BottomNav = () => (
    <div className="md:hidden fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-800 flex justify-around p-3 z-50 safe-area-bottom">
      <button onClick={() => setView('home')} className={`flex flex-col items-center ${view === 'home' ? 'text-cyan-400' : 'text-gray-500'}`}>
        <Home size={20} />
        <span className="text-xs mt-1">Home</span>
      </button>
      <button onClick={() => setView('community')} className={`flex flex-col items-center ${view === 'community' ? 'text-cyan-400' : 'text-gray-500'}`}>
        <Users size={20} />
        <span className="text-xs mt-1">Community</span>
      </button>
      <button onClick={() => setView('sell')} className={`flex flex-col items-center ${view === 'sell' ? 'text-cyan-400' : 'text-gray-500'}`}>
        <PlusCircle size={20} />
        <span className="text-xs mt-1">Sell</span>
      </button>
      <button onClick={() => setView('seller-dashboard')} className={`flex flex-col items-center ${view === 'seller-dashboard' ? 'text-cyan-400' : 'text-gray-500'}`}>
        <TrendingUp size={20} />
        <span className="text-xs mt-1">Shop</span>
      </button>
      <button onClick={() => setView('profile')} className={`flex flex-col items-center ${view === 'profile' ? 'text-cyan-400' : 'text-gray-500'}`}>
        <User size={20} />
        <span className="text-xs mt-1">Me</span>
      </button>
    </div>
  );

  const HomeView = () => (
    <div className="pb-20">
      {/* Configuration Error Banner */}
      {configError && (
        <div className="bg-orange-600/90 text-white text-sm p-3 text-center flex items-center justify-center gap-2 backdrop-blur-sm sticky top-16 z-30">
          <AlertTriangle size={16} />
          <span><b>Local Preview Mode:</b> Firebase API Key is missing. Login & Checkout are disabled.</span>
        </div>
      )}

      {/* Hero Section */}
      <div className="relative bg-slate-900 overflow-hidden mb-8 py-16 md:py-24">
        {/* Background Gradients */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-purple-900 via-slate-900 to-black opacity-80"></div>
        {/* Dotted Pattern Overlay (CSS simulated) */}
        <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(#4f46e5 1px, transparent 1px)', backgroundSize: '24px 24px' }}></div>
        
        <div className="relative max-w-4xl mx-auto px-4 flex flex-col items-center text-center z-10">
          <h1 className="text-5xl md:text-7xl font-black text-white mb-2 tracking-tight leading-none">
            TRADE. SWAP.
          </h1>
          <h1 className="text-5xl md:text-7xl font-black mb-6 tracking-tight leading-none text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-500">
            UPGRADE.
          </h1>
          
          <p className="text-gray-300 mb-10 max-w-xl text-lg md:text-xl leading-relaxed">
            Malaysia's premier marketplace for PC enthusiasts. Find rare parts, swap your old rig, or buy your dream setup.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 w-full justify-center">
            <button 
              onClick={() => { setSelectedCategory('gpu'); window.scrollTo(0, 800); }} 
              className="px-8 py-4 bg-cyan-500 hover:bg-cyan-400 text-white font-bold rounded-xl shadow-lg shadow-cyan-500/25 transition-all transform hover:-translate-y-1 text-lg w-full sm:w-auto"
            >
              Browse Parts
            </button>
            <button 
              onClick={() => { setShowSwapOnly(true); window.scrollTo(0, 800); }} 
              className="px-8 py-4 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl shadow-lg shadow-purple-600/25 flex items-center justify-center gap-2 transition-all transform hover:-translate-y-1 text-lg w-full sm:w-auto"
            >
              <Repeat size={20}/> Find Swaps
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4">
        
        {/* Only show Featured Section if we have real products */}
        {featuredProducts.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-4">
              <Flame className="text-orange-500 fill-orange-500" size={24} />
              <h2 className="text-2xl font-bold text-white tracking-wide">Featured of the Week</h2>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {featuredProducts.map(product => (
                <div 
                  key={product.id}
                  onClick={() => { setSelectedProduct(product); setView('product'); }}
                  className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700/50 rounded-xl overflow-hidden hover:border-orange-500/50 transition-all cursor-pointer group shadow-lg relative"
                >
                  <div className="absolute top-2 right-2 bg-orange-500 text-white text-[10px] font-bold px-2 py-1 rounded-full z-10 shadow-lg flex items-center gap-1">
                    <Flame size={10} fill="currentColor"/> HOT
                  </div>
                  
                  <div className={`absolute bottom-0 left-0 w-full h-1 ${product.category === 'gpu' ? 'bg-green-500' : product.category === 'cpu' ? 'bg-blue-500' : product.category === 'prebuilt' ? 'bg-purple-500' : 'bg-orange-500'}`}></div>

                  <div className="aspect-[4/3] bg-slate-900 relative overflow-hidden flex items-center justify-center">
                    <img 
                      src={product.images?.[0] || 'https://via.placeholder.com/400/1e293b/FFFFFF?text=No+Image'} 
                      alt={product.title} 
                      className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                    />
                  </div>
                  <div className="p-4">
                    <div className="text-[10px] uppercase font-bold text-gray-500 mb-1">{product.category}</div>
                    <h3 className="text-white font-bold line-clamp-1 group-hover:text-orange-400 transition-colors">{product.title}</h3>
                    <p className="text-orange-400 font-extrabold mt-1">{formatCurrency(product.price)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Categories & Filter */}
        <div className="flex flex-col md:flex-row justify-between items-end mb-4 border-b border-slate-800 pb-2">
          <div className="flex items-center gap-3"> {/* // UI-ONLY: dynamic badge */}
            <h2 className="text-xl font-bold text-white flex items-center gap-2">RIGX Marketplace</h2> {/* // UI-ONLY: marketplace title */}
            <span className={`text-xs font-semibold uppercase tracking-[0.3em] px-3 py-1 rounded-full border ${marketplaceBadgeStyle} ${prefersReducedMotion ? '' : 'shadow-[0_0_12px_rgba(14,165,233,0.35)]'}`}>{marketplaceBadgeLabel}</span> {/* // UI-ONLY: dynamic badge */}
          </div> {/* // UI-ONLY: dynamic badge */}
          
          <div className="flex items-center gap-4 mt-4 md:mt-0 flex-wrap"> {/* // FIX: state filter */}
            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer select-none bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700 hover:border-purple-500 transition-colors">
              <input 
                type="checkbox" 
                checked={showSwapOnly} 
                onChange={(e) => setShowSwapOnly(e.target.checked)}
                className="rounded bg-slate-700 border-slate-600 text-purple-500 focus:ring-purple-500"
              />
              <span className="flex items-center gap-1"><ArrowRightLeft size={14} className="text-purple-400"/> Show Swaps Only</span>
            </label>
            <div className="state-filter-gaming relative flex flex-col text-sm text-gray-200 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 overflow-hidden"> {/* // UI-ONLY: state filter gaming */}
              <div className="pointer-events-none state-filter-glow" aria-hidden="true"></div> {/* // UI-ONLY: state filter gaming */}
              <label className="text-xs uppercase tracking-[0.4em] text-gray-400">State (Malaysia)</label> {/* // UI-ONLY: state filter gaming */}
              <select className="mt-2 bg-slate-900/70 border border-white/10 rounded-xl px-3 py-2 text-sm text-gray-100 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/50 transition-colors" value={selectedState} onChange={(e) => setSelectedState(e.target.value)}> {/* // UI-ONLY: state filter gaming */}
                <option value="all">All States</option> {/* // UI-ONLY: state filter gaming */}
                {MALAYSIAN_STATES.map((state) => <option key={state} value={state}>{state}</option>)} {/* // UI-ONLY: state filter gaming */}
              </select> {/* // UI-ONLY: state filter gaming */}
            </div> {/* // UI-ONLY: state filter gaming */}
          </div>
        </div>

        <div className="flex gap-3 overflow-x-auto pb-6 scrollbar-hide mb-8">
          <button 
            onClick={() => setSelectedCategory(null)}
            className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-bold border transition-all ${selectedCategory === null ? 'bg-cyan-600 border-cyan-500 text-white' : 'bg-slate-800 border-slate-700 text-gray-400 hover:text-white'}`}
          >
            All
          </button>
          {CATEGORIES.map(cat => (
            <button 
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-bold border transition-all flex items-center gap-2 ${selectedCategory === cat.id ? 'bg-cyan-600 border-cyan-500 text-white' : 'bg-slate-800 border-slate-700 text-gray-400 hover:text-white'}`}
            >
              {cat.icon} {cat.name}
            </button>
          ))}
        </div>

        {/* NEW: Recommended For You Section - Real Data Only */}
        <RecommendedSection />

        {/* ===== HOT ITEM OF THE WEEK START ===== */} {/* // UI-ONLY */}
        <section className="relative mb-10" aria-labelledby="hot-item-title"> {/* // UI-ONLY */}
          <div className="hot-shell absolute inset-0 pointer-events-none" aria-hidden="true"></div> {/* // UI-ONLY */}
          <div className="relative rounded-[32px] border border-white/10 bg-[#04060f]/90 p-6 shadow-[0_25px_80px_rgba(0,0,0,0.6)] overflow-hidden"> {/* // UI-ONLY */}
            <div className="relative z-10 flex flex-col gap-4 md:flex-row md:items-center md:justify-between"> {/* // UI-ONLY */}
              <div> {/* // UI-ONLY */}
                <p className="text-xs uppercase tracking-[0.4em] text-amber-300/70">Community Picks</p> {/* // UI-ONLY */}
                <h2 id="hot-item-title" className="flex items-center gap-3 text-2xl font-black tracking-tight text-white"> {/* // UI-ONLY */}
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-pink-500 text-lg text-slate-900 shadow-lg shadow-amber-500/40">🔥</span> {/* // UI-ONLY */}
                  Hot Item of the Week {/* // UI-ONLY */}
                </h2>
                <p className="text-sm text-gray-400 mt-2 max-w-3xl"> {/* // UI-ONLY */}
                  A free carousel featuring ten random community listings. Scroll or hover to pause, resume to keep the showcase gliding. {/* // UI-ONLY */}
                </p> {/* // UI-ONLY */}
              </div>
              <span className="px-4 py-2 rounded-full border border-amber-400/40 text-amber-200 text-xs font-semibold tracking-[0.3em]"> {/* // UI-ONLY */}
                Public Feature {/* // UI-ONLY */}
              </span> {/* // UI-ONLY */}
            </div>
            <div className="mt-6 rounded-2xl border border-white/10 bg-black/30 p-4 backdrop-blur"> {/* // UI-ONLY */}
              {hotLoading ? (
                <>
                  {/* // UI-ONLY */}
                  <p className="text-sm text-gray-400">Curating hot items...</p> {/* // UI-ONLY */}
                </>
              ) : hotItems.length === 0 ? (
                <>
                  {/* // UI-ONLY */}
                  <p className="text-sm text-gray-400">No hot picks yet. List more items to get featured!</p> {/* // UI-ONLY */}
                </>
              ) : (
                <>
                  {/* // UI-ONLY */}
                  <div
                    className="overflow-hidden"
                    onMouseEnter={() => { if (!prefersReducedMotion) setHotPaused(true); }}
                    onMouseLeave={() => { if (!prefersReducedMotion) setHotPaused(false); }}
                  >
                    <div
                      className={`hot-track flex gap-4 ${hotPaused || prefersReducedMotion ? 'paused' : ''}`}
                    >
                      {[...hotItems, ...hotItems].map((item, index) => (
                        <button
                          key={`${item.id}-${index}`}
                          type="button"
                          className="hot-card w-64 flex-shrink-0 rounded-2xl border border-white/10 bg-slate-900/80 p-3 text-left transition hover:border-amber-400/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                          onClick={() => { setSelectedProduct(item); setView('product'); }}
                        >
                          <div className="relative h-36 w-full overflow-hidden rounded-xl border border-white/5 bg-slate-950">
                            <img
                              src={item.images?.[0] || 'https://via.placeholder.com/300/1e293b/FFFFFF?text=Hot+Item'}
                              alt={item.title}
                              className="h-full w-full object-cover"
                            />
                            <span className="absolute top-2 right-2 rounded-full bg-gradient-to-r from-amber-400 to-pink-500 px-2 py-0.5 text-[10px] font-bold text-slate-900 shadow">
                              HOT
                            </span>
                          </div>
                          <div className="mt-3 space-y-1">
                            <h3 className="text-sm font-semibold text-white line-clamp-2">{item.title}</h3>
                            <p className="text-amber-200 font-bold text-lg">{formatCurrency(item.price || 0)}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </section>
        {/* ===== HOT ITEM OF THE WEEK END ===== */} {/* // UI-ONLY */}

        {/* REPAIR SECTION REMOVED FROM HERE */}

        {/* Product Grid - Real Data Only */}
        <div className="mb-4">
              <h2 className="text-xl font-bold text-white mb-4">Latest Listings</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
               {filteredProducts.length > 0 ? filteredProducts.map(product => (
                <div 
                  key={product.id} 
                  onClick={() => { setSelectedProduct(product); setView('product'); }}
                  className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden hover:border-cyan-500 transition-all cursor-pointer group shadow-md relative"
                >
                  <div className="aspect-square bg-slate-900 relative overflow-hidden">
                      <img 
                       src={product.images?.[0] || 'https://via.placeholder.com/300/1e293b/FFFFFF?text=No+Image'} 
                       alt={product.title} 
                       className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                     />
                     
                     {/* Condition Badge */}
                     <div className="absolute top-2 left-2 flex flex-col gap-1">
                       {product.condition === 'Used' && <span className="bg-slate-900/80 backdrop-blur text-white text-[10px] font-bold px-2 py-1 rounded border border-slate-600">USED</span>}
                       {product.condition === 'New' && <span className="bg-green-600 text-white text-[10px] font-bold px-2 py-1 rounded shadow-sm">NEW</span>}
                     </div>

                     {/* Like Button */}
                     <button 
                       onClick={(e) => toggleFavorite(e, product.id)}
                       className="absolute top-2 right-2 p-1.5 bg-slate-900/50 rounded-full hover:bg-slate-800 transition-colors z-10"
                     >
                       <Heart size={16} className={favorites.has(product.id) ? "fill-red-500 text-red-500" : "text-white"} />
                     </button>

                     {/* Swap Badge */}
                     {(product.listingType === 'swap' || product.listingType === 'both') && (
                       <div className="absolute bottom-2 right-2">
                         <span className="bg-purple-600 text-white text-[10px] font-bold px-2 py-1 rounded shadow-sm flex items-center gap-1">
                           <Repeat size={10}/> SWAP
                         </span>
                       </div>
                     )}
                   </div>
                   <div className="p-3">
                     <h3 className="text-white text-sm font-bold line-clamp-2 min-h-[40px] group-hover:text-cyan-400 transition-colors">{product.title}</h3>
                     <div className="flex items-center justify-between mt-2">
                       <span className="text-cyan-400 font-bold text-lg">{formatCurrency(product.price)}</span>
                     </div>
                     <div className="flex justify-between items-center mt-2 text-xs text-gray-500">
                        <div className="flex items-center gap-1"><Star size={10} className="fill-yellow-500 text-yellow-500"/> {product.rating || 'New'}</div>
                        <span>{product.location}</span>
                     </div>
                   </div>
                 </div>
               )) : (
                 <div className="col-span-full text-center py-20 bg-slate-800/50 rounded-lg border border-dashed border-slate-700 mt-4">
                    <Search className="mx-auto h-12 w-12 text-gray-600 mb-2"/>
                    <p className="text-gray-400">No listings found matching your criteria.</p>
                    {configError && <p className="text-orange-400 text-sm mt-2">Database connection unavailable in Preview Mode.</p>}
                    {!configError && <p className="text-cyan-400 text-sm mt-2 cursor-pointer" onClick={() => setView('sell')}>Be the first to sell something!</p>}
                 </div>
               )}
            </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-900 text-gray-100 font-sans selection:bg-cyan-500 selection:text-white">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <Navbar />
      <main className="min-h-screen">
        {loading ? (
          <div className="flex items-center justify-center h-screen text-cyan-400 animate-pulse">Loading RigX.my...</div>
        ) : (
          <>
            {view === 'home' && <HomeView />}
            {view === 'community' && <CommunityView />}
            {view === 'product' && selectedProduct && <ProductDetailView />}
            {view === 'cart' && <CartView />}
            {view === 'sell' && <SellView />}
            {view === 'login' && <AuthView mode="login" />}
            {view === 'register' && <AuthView mode="register" />}
            {view === 'profile' && <ProfileView />}
            {view === 'chat' && <ChatView />}
            {view === 'seller-dashboard' && <SellerDashboard />}
          </>
        )}
      </main>

      {/* Render Review Modal */}
      <ReviewModal />
      {/* Render Repair Modal */}
      <RepairModal />
      {renderSettingsModal()} {/* ===== PROFILE SETTINGS START ===== */} // FIX: settings focus

      {/* Support Menu */}
      <SupportMenu />

      {/* Floating Help Button */}
      <button 
        onMouseDown={handleFabMouseDown}
        onTouchStart={handleFabMouseDown}
        onClick={handleFabClick}
        style={{ 
          transform: `translate(${fabPos.x}px, ${fabPos.y}px)`,
          touchAction: 'none' // Crucial for touch dragging
        }}
        className="fixed bottom-20 right-4 md:bottom-8 md:right-8 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white p-3 rounded-full shadow-lg shadow-cyan-600/40 z-50 cursor-grab active:cursor-grabbing flex items-center gap-2 group border border-cyan-400/50"
      >
        <MessageCircleQuestion size={28} />
        <span className="max-w-0 overflow-hidden group-hover:max-w-xs transition-all duration-300 ease-in-out whitespace-nowrap text-sm font-bold pl-0 group-hover:pl-2">
          Ask RIGX
        </span>
      </button>

      <BottomNav />
      {/* // UI-ONLY */}
      <style jsx global>{` /* ===== GAMING LOGIN ANIMATIONS ===== */
        .gaming-card::before,
        .gaming-card::after {
          content: '';
          position: absolute;
          inset: -12px;
          border-radius: 32px;
          background: radial-gradient(circle at 20% 20%, rgba(34,211,238,0.4), transparent 55%),
            radial-gradient(circle at 80% 30%, rgba(168,85,247,0.35), transparent 50%);
          filter: blur(20px);
          z-index: -1;
          animation: gamingRgbGlow 14s ease-in-out infinite;
        }
        .gaming-card::after {
          inset: -4px;
          filter: blur(8px);
          opacity: 0.6;
        }
        .gaming-button::before {
          content: '';
          position: absolute;
          inset: 2px;
          border-radius: inherit;
          background: linear-gradient(90deg, rgba(6,182,212,0.15), rgba(59,130,246,0.25), rgba(168,85,247,0.15));
          animation: gamingShimmer 10s linear infinite;
        }
        .gaming-button::after {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          background: radial-gradient(circle at 20% 50%, rgba(255,255,255,0.25), transparent 50%);
          mix-blend-mode: screen;
          opacity: 0;
          transition: opacity 0.4s ease;
        }
        .gaming-button:hover::after,
        .gaming-button:focus-visible::after {
          opacity: 0.4;
        }
        .gpu-panel {
          animation: gamingPanelDrift 18s ease-in-out infinite alternate;
        }
        .gpu-circuit {
          background-image:
            linear-gradient(120deg, rgba(20,184,166,0.25) 0%, transparent 40%),
            repeating-linear-gradient(0deg, rgba(148,163,184,0.08), rgba(148,163,184,0.08) 2px, transparent 2px, transparent 6px);
          opacity: 0.25;
          animation: gamingCircuitDrift 22s linear infinite;
        }
        .gpu-shimmer {
          background: linear-gradient(110deg, transparent, rgba(59,130,246,0.15), transparent);
          animation: gamingShimmer 12s linear infinite;
          mix-blend-mode: screen;
          opacity: 0.2;
        }
        .gpu-fan::before,
        .gpu-fan::after {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          border: 1px solid rgba(255,255,255,0.08);
          animation: gamingFanSpin 16s linear infinite;
        }
        .gpu-fan::after {
          inset: 12px;
          opacity: 0.4;
          animation-direction: reverse;
        }
        @keyframes gamingRgbGlow {
          0% { opacity: 0.4; transform: scale(0.98); }
          50% { opacity: 0.9; transform: scale(1.02); }
          100% { opacity: 0.4; transform: scale(0.98); }
        }
        @keyframes gamingPanelDrift {
          0% { transform: translate3d(-10px, 0, 0); }
          100% { transform: translate3d(10px, -4px, 0); }
        }
        @keyframes gamingCircuitDrift {
          0% { transform: translate3d(0, 0, 0); }
          100% { transform: translate3d(-40px, -20px, 0); }
        }
        @keyframes gamingShimmer {
          0% { transform: translateX(-30%); }
          100% { transform: translateX(30%); }
        }
        @keyframes gamingFanSpin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          .gaming-card::before,
          .gaming-card::after,
          .gaming-button::before,
          .gaming-button::after,
          .gpu-panel,
          .gpu-circuit,
          .gpu-shimmer,
          .gpu-fan::before,
          .gpu-fan::after {
            animation: none !important;
          }
        }
        /* ===== COMMUNITY GAMING ANIMATIONS ===== */
        .community-card {
          position: relative;
          overflow: hidden;
        }
        .community-card::before,
        .community-card::after {
          content: '';
          position: absolute;
          inset: -10px;
          border-radius: 32px;
          background: radial-gradient(circle at 20% 20%, rgba(59,130,246,0.35), transparent 55%),
            radial-gradient(circle at 80% 30%, rgba(236,72,153,0.3), transparent 60%);
          filter: blur(25px);
          opacity: 0.6;
          animation: communityGlow 12s ease-in-out infinite;
          z-index: -1;
        }
        .community-card::after {
          inset: -4px;
          opacity: 0.3;
        }
        .community-grid {
          background-image:
            linear-gradient(120deg, rgba(59,130,246,0.1) 0%, transparent 50%),
            linear-gradient(300deg, rgba(236,72,153,0.1) 0%, transparent 55%),
            repeating-linear-gradient(0deg, rgba(148,163,184,0.06), rgba(148,163,184,0.06) 1px, transparent 1px, transparent 12px),
            repeating-linear-gradient(90deg, rgba(148,163,184,0.05), rgba(148,163,184,0.05) 1px, transparent 1px, transparent 12px);
          animation: communityGridMove 18s linear infinite;
          filter: blur(2px);
        }
        .community-post {
          position: relative;
          overflow: hidden;
        }
        .community-post::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          background: linear-gradient(120deg, rgba(59,130,246,0.08), transparent 60%);
          opacity: 0.7;
          mix-blend-mode: screen;
          animation: communityGlow 14s ease-in-out infinite;
          z-index: 0;
        }
        .community-post > * {
          position: relative;
          z-index: 1;
        }
        /* ===== PROFILE SETTINGS START ===== */
        .settings-shell {
          position: relative;
          overflow: hidden;
        }
        .settings-shell::before,
        .settings-shell::after {
          content: '';
          position: absolute;
          inset: -20px;
          border-radius: inherit;
          background: radial-gradient(circle at 30% 20%, rgba(34,211,238,0.18), transparent 55%),
            radial-gradient(circle at 70% 80%, rgba(168,85,247,0.15), transparent 50%);
          filter: blur(25px);
          opacity: 0.8;
          animation: settingsGlow 14s ease-in-out infinite;
          z-index: -1;
        }
        .settings-shell::after {
          inset: -8px;
          opacity: 0.4;
        }
        @keyframes settingsGlow {
          0% { opacity: 0.4; transform: scale(0.98); }
          50% { opacity: 0.9; transform: scale(1.01); }
          100% { opacity: 0.4; transform: scale(0.98); }
        }
        @media (prefers-reduced-motion: reduce) {
          .settings-shell::before,
          .settings-shell::after {
            animation: none !important;
            opacity: 0.5;
          }
        }
        /* ===== PROFILE SETTINGS END ===== */
        @keyframes communityGlow {
          0% { opacity: 0.45; transform: scale(0.98); }
          50% { opacity: 0.9; transform: scale(1.01); }
          100% { opacity: 0.45; transform: scale(0.98); }
        }
        @keyframes communityGridMove {
          0% { transform: translate3d(0, 0, 0); }
          100% { transform: translate3d(-60px, -40px, 0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .community-card::before,
          .community-card::after,
          .community-grid,
          .community-post::before {
            animation: none !important;
          }
        }
        /* ===== HIGHLIGHT SECTION ANIMATIONS ===== */
        /* ===== STATE FILTER GAMING ANIMATIONS ===== */ /* // UI-ONLY: state filter gaming */
        .state-filter-gaming {
          position: relative;
        } /* // UI-ONLY: state filter gaming */
        .state-filter-glow {
          position: absolute;
          inset: -1px;
          border-radius: 20px;
          border: 1px solid rgba(59,130,246,0.35);
          background: linear-gradient(120deg, rgba(59,130,246,0.15), rgba(236,72,153,0.12), rgba(14,165,233,0.15));
          box-shadow: 0 0 15px rgba(59,130,246,0.25), inset 0 0 20px rgba(236,72,153,0.15);
          animation: stateFilterBreath 14s ease-in-out infinite;
          opacity: 0.8;
          z-index: 0;
        } /* // UI-ONLY: state filter gaming */
        .state-filter-gaming > *:not(.state-filter-glow) {
          position: relative;
          z-index: 1;
        } /* // UI-ONLY: state filter gaming */
        @keyframes stateFilterBreath {
          0% { opacity: 0.5; transform: scale(0.98); }
          50% { opacity: 1; transform: scale(1); }
          100% { opacity: 0.5; transform: scale(0.98); }
        } /* // UI-ONLY: state filter gaming */
        @media (prefers-reduced-motion: reduce) {
          .state-filter-glow {
            animation: none !important;
          }
        } /* // UI-ONLY: state filter gaming */
        /* ===== HOT ITEM ANIMATIONS ===== */ /* // UI-ONLY */
        .hot-shell { /* // UI-ONLY */
          border-radius: 32px; /* // UI-ONLY */
          background-image: /* // UI-ONLY */
            linear-gradient(135deg, rgba(251,191,36,0.1), transparent 60%), /* // UI-ONLY */
            linear-gradient(315deg, rgba(14,165,233,0.08), transparent 60%), /* // UI-ONLY */
            repeating-linear-gradient(0deg, rgba(148,163,184,0.04), rgba(148,163,184,0.04) 1px, transparent 1px, transparent 18px), /* // UI-ONLY */
            repeating-linear-gradient(90deg, rgba(148,163,184,0.04), rgba(148,163,184,0.04) 1px, transparent 1px, transparent 18px); /* // UI-ONLY */
          animation: hotShell 16s linear infinite; /* // UI-ONLY */
        }
        .hot-track { /* // UI-ONLY */
          animation: hotMarquee 35s linear infinite; /* // UI-ONLY */
          will-change: transform; /* // UI-ONLY */
        }
        .hot-track.paused { /* // UI-ONLY */
          animation-play-state: paused; /* // UI-ONLY */
        }
        .hot-card { /* // UI-ONLY */
          box-shadow: 0 15px 35px rgba(251,191,36,0.2); /* // UI-ONLY */
        }
        @keyframes hotShell { /* // UI-ONLY */
          0% { transform: translate3d(0,0,0); } /* // UI-ONLY */
          50% { transform: translate3d(-25px,-10px,0); } /* // UI-ONLY */
          100% { transform: translate3d(0,0,0); } /* // UI-ONLY */
        }
        @keyframes hotMarquee { /* // UI-ONLY */
          0% { transform: translateX(0); } /* // UI-ONLY */
          100% { transform: translateX(-50%); } /* // UI-ONLY */
        }
        @media (prefers-reduced-motion: reduce) {
          .hot-shell,
          .hot-track {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}
