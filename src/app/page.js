'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
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
  updateProfile 
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
  limit
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
  CreditCard,
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
  Printer,
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
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [toast, setToast] = useState(null);
  const [showSwapOnly, setShowSwapOnly] = useState(false);
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
  const [mySales, setMySales] = useState([]);
  
  // New State for Recommendations
  const [favorites, setFavorites] = useState(new Set()); 
  const [recentSearches, setRecentSearches] = useState([]); 

  // Draggable FAB State
  const [fabPos, setFabPos] = useState({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const initialFabPosRef = useRef({ x: 0, y: 0 });

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
        } else {
          // Don't auto-sign in anonymously if we want a login flow
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
          setUser(u);
          setLoading(false);
        });
    } catch(e) { console.error(e) }

    return () => unsubscribe();
  }, []);

  // Data Fetching (Products)
  useEffect(() => {
    if (configError) return;
    try {
        const q = collection(db, 'artifacts', appId, 'public', 'data', 'products');
        const unsubscribe = onSnapshot(q, (snapshot) => {
          const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          setProducts(items);
        }, (err) => console.error("Data fetch error", err));
        return () => unsubscribe();
    } catch (e) {
        console.log("Firestore unavailable");
    }
  }, [configError]);

  // Track Recent Searches
  useEffect(() => {
    if (searchQuery.length > 3 && !recentSearches.includes(searchQuery.toLowerCase())) {
        const timeoutId = setTimeout(() => {
             setRecentSearches(prev => [searchQuery.toLowerCase(), ...prev].slice(0, 5));
        }, 1500); 
        return () => clearTimeout(timeoutId);
    }
  }, [searchQuery]);

  const showToast = (msg, type = 'success') => {
    setToast({ message: msg, type });
    setTimeout(() => setToast(null), 3000);
  };

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
    if (!user) return;
    try {
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'products'), {
        ...productData,
        sellerId: user.uid,
        sellerName: user.displayName || 'Anonymous Seller',
        createdAt: serverTimestamp(),
        rating: 0,
        sales: 0
      });
      showToast('Listing published successfully!');
      setView('seller-dashboard');
    } catch (e) {
      showToast('Error publishing listing: ' + e.message, 'error');
    }
  };

  const handleCheckout = async (address, paymentMethod) => {
    if (configError) { showToast("Checkout disabled", "error"); return; }
    if (!user || cart.length === 0) return;
    
    showToast(`Redirecting to ${paymentMethod === 'fpx' ? 'ToyyibPay' : 'Secure Gateway'}...`, "success");
    setLoading(true);

    setTimeout(async () => {
        try {
          // 1. Save "Order" for Buyer
          const orderData = {
            buyerId: user.uid,
            items: cart,
            total: cart.reduce((sum, item) => sum + (item.price * item.qty), 0),
            status: 'To Ship', 
            address,
            paymentMethod,
            createdAt: serverTimestamp(),
            trackingNumber: null
          };
          await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'orders'), orderData);

          // 2. Save "Sale" for Seller(s)
          for (const item of cart) {
             if (item.sellerId) {
                 const saleData = {
                     itemId: item.id,
                     title: item.title,
                     price: item.price,
                     qty: item.qty,
                     buyerName: user.displayName || 'Anonymous Buyer',
                     status: 'To Ship',
                     createdAt: serverTimestamp(),
                     courier: COURIERS[Math.floor(Math.random() * COURIERS.length)] 
                 };
                 await addDoc(collection(db, 'artifacts', appId, 'users', item.sellerId, 'sales'), saleData);
             }
          }

          setCart([]);
          setLoading(false);
          showToast('Payment Successful! Order placed.');
          setView('profile'); 
        } catch (e) {
          console.error(e);
          setLoading(false);
          showToast('Payment verification failed', 'error');
        }
    }, 2000); 
  };

  // Review Submission Logic
  const handleSubmitReview = async (rating, comment) => {
    if (!user || !reviewTarget) return;
    setLoading(true);
    try {
        await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'reviews'), {
            sellerId: reviewTarget.sellerId,
            buyerId: user.uid,
            buyerName: user.displayName || 'Anonymous',
            rating: rating,
            comment: comment,
            productId: reviewTarget.itemId,
            productTitle: reviewTarget.itemTitle,
            createdAt: serverTimestamp()
        });
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

  // --- Filtering Logic ---
  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      const matchesSearch = p.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                            p.category.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = selectedCategory ? p.category === selectedCategory : true;
      const matchesSwap = showSwapOnly ? (p.listingType === 'swap' || p.listingType === 'both') : true;
      return matchesSearch && matchesCategory && matchesSwap;
    });
  }, [products, searchQuery, selectedCategory, showSwapOnly]);

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
    const [isLogin, setIsLogin] = useState(mode === 'login');

    const handleAuth = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            if (isLogin) {
                await signInWithEmailAndPassword(auth, email, password);
                showToast("Welcome back!", "success");
            } else {
                const cred = await createUserWithEmailAndPassword(auth, email, password);
                await updateProfile(cred.user, { displayName: email.split('@')[0] });
                showToast("Account created successfully!", "success");
            }
            setView('home');
        } catch (error) {
            showToast(error.message, "error");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-[80vh] px-4">
            <div className="bg-slate-800 p-8 rounded-xl border border-slate-700 w-full max-w-md">
                <h2 className="text-3xl font-black text-white mb-6 text-center">{isLogin ? 'Login' : 'Register'}</h2>
                <form onSubmit={handleAuth} className="space-y-4">
                    <div>
                        <label className="block text-gray-400 text-sm mb-1">Email</label>
                        <input type="email" required className="w-full bg-slate-900 border border-slate-700 rounded p-3 text-white focus:border-cyan-500 outline-none" value={email} onChange={e=>setEmail(e.target.value)} />
                    </div>
                    <div>
                        <label className="block text-gray-400 text-sm mb-1">Password</label>
                        <input type="password" required className="w-full bg-slate-900 border border-slate-700 rounded p-3 text-white focus:border-cyan-500 outline-none" value={password} onChange={e=>setPassword(e.target.value)} />
                    </div>
                    <button type="submit" className="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-3 rounded transition-colors">
                        {isLogin ? 'Sign In' : 'Sign Up'}
                    </button>
                </form>
                <div className="mt-4 text-center">
                    <button onClick={() => setIsLogin(!isLogin)} className="text-cyan-400 text-sm hover:underline">
                        {isLogin ? "Don't have an account? Sign Up" : "Already have an account? Sign In"}
                    </button>
                </div>
                <div className="mt-4 text-center border-t border-slate-700 pt-4">
                   <button onClick={() => { signInAnonymously(auth); setView('home'); }} className="text-gray-500 text-xs hover:text-white">
                        Continue as Guest
                   </button>
                </div>
            </div>
        </div>
    );
  };

  const ProductDetailView = () => {
    const [sellerReviews, setSellerReviews] = useState([]);
    const [avgRating, setAvgRating] = useState(0);

    // Fetch reviews for this seller
    useEffect(() => {
        if (!selectedProduct?.sellerId) return;
        
        const q = query(
            collection(db, 'artifacts', appId, 'public', 'data', 'reviews'),
            where('sellerId', '==', selectedProduct.sellerId),
            orderBy('createdAt', 'desc'),
            limit(10)
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const reviews = snapshot.docs.map(d => ({id: d.id, ...d.data()}));
            setSellerReviews(reviews);
            if (reviews.length > 0) {
                const total = reviews.reduce((acc, curr) => acc + curr.rating, 0);
                setAvgRating((total / reviews.length).toFixed(1));
            } else {
                setAvgRating(0);
            }
        });
        
        return () => unsubscribe();
    }, [selectedProduct]);

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
                        <button onClick={() => setView('checkout')} className="w-full py-3 bg-green-600 hover:bg-green-500 text-white font-bold rounded shadow-lg shadow-green-600/20">
                            Proceed to Checkout
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
  };

  const CheckoutView = () => {
      const [address, setAddress] = useState('');
      const [payment, setPayment] = useState('fpx');
      
      return (
        <div className="max-w-2xl mx-auto p-4 pb-24">
            <div className="flex items-center gap-2 mb-6">
                <button onClick={() => setView('cart')} className="p-1 hover:bg-slate-800 rounded"><ChevronLeft/></button>
                <h1 className="text-2xl font-bold">Checkout</h1>
            </div>
            
            <div className="space-y-6">
                <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
                    <h3 className="font-bold text-white mb-2 flex items-center gap-2"><MapPin size={16} className="text-cyan-400"/> Delivery Address</h3>
                    <textarea 
                        className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-sm text-white focus:border-cyan-500 outline-none" 
                        rows="3" 
                        placeholder="Enter full address..."
                        value={address}
                        onChange={e => setAddress(e.target.value)}
                    />
                </div>

                <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
                    <h3 className="font-bold text-white mb-2 flex items-center gap-2"><CreditCard size={16} className="text-cyan-400"/> Payment Method</h3>
                    <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => setPayment('fpx')} className={`p-3 rounded border text-sm font-bold ${payment === 'fpx' ? 'bg-cyan-600 border-cyan-500 text-white' : 'bg-slate-900 border-slate-600 text-gray-400'}`}>
                            Online Banking (FPX)
                        </button>
                        <button onClick={() => setPayment('card')} className={`p-3 rounded border text-sm font-bold ${payment === 'card' ? 'bg-cyan-600 border-cyan-500 text-white' : 'bg-slate-900 border-slate-600 text-gray-400'}`}>
                            Credit/Debit Card
                        </button>
                    </div>
                </div>

                <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
                    <h3 className="font-bold text-white mb-2">Order Summary</h3>
                    {cart.map(item => (
                        <div key={item.id} className="flex justify-between text-sm text-gray-400 py-1">
                            <span className="truncate flex-1 pr-4">{item.title} (x{item.qty})</span>
                            <span>{formatCurrency(item.price * item.qty)}</span>
                        </div>
                    ))}
                    <div className="border-t border-slate-700 mt-2 pt-2 flex justify-between font-bold text-white text-lg">
                        <span>Total Pay</span>
                        <span>{formatCurrency(cart.reduce((a,b) => a + (b.price * b.qty), 0))}</span>
                    </div>
                </div>

                <button onClick={() => handleCheckout(address, payment)} className="w-full py-4 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-lg shadow-xl">
                    Place Order
                </button>
            </div>
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
      const [userOrders, setUserOrders] = useState([]);
      
      useEffect(() => {
          if(!user) return;
          const q = collection(db, 'artifacts', appId, 'users', user.uid, 'orders');
          const unsub = onSnapshot(q, snap => {
              setUserOrders(snap.docs.map(d => ({id: d.id, ...d.data()})));
          });
          return () => unsub();
      }, [user]);

      if (!user) return <AuthView mode="login" />;

      return (
          <div className="max-w-2xl mx-auto p-4 pb-24">
              <div className="bg-slate-800 p-6 rounded-lg border border-slate-700 mb-6 flex items-center gap-4">
                  <div className="w-16 h-16 bg-cyan-600 rounded-full flex items-center justify-center text-2xl font-bold text-white">
                      {user.displayName?.[0]?.toUpperCase() || 'U'}
                  </div>
                  <div>
                      <h2 className="text-xl font-bold text-white">{user.displayName || 'User'}</h2>
                      <p className="text-gray-400 text-sm">{user.email}</p>
                      <button onClick={() => signOut(auth)} className="text-red-400 text-sm mt-1 hover:underline flex items-center gap-1">
                          <LogOut size={14}/> Sign Out
                      </button>
                  </div>
              </div>

              <h3 className="font-bold text-white mb-4 flex items-center gap-2"><Package className="text-cyan-400"/> My Purchases</h3>
              <div className="space-y-3">
                  {userOrders.map(order => (
                      <div key={order.id} className="bg-slate-800 p-4 rounded-lg border border-slate-700">
                          <div className="flex justify-between items-start mb-2">
                              <span className="text-xs text-gray-500">Order ID: {order.id.slice(0,8)}</span>
                              <span className="text-xs bg-orange-500/20 text-orange-400 px-2 py-1 rounded">{order.status}</span>
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
                              <span className="text-sm text-gray-400">Total Paid:</span>
                              <span className="font-bold text-white">{formatCurrency(order.total)}</span>
                          </div>
                      </div>
                  ))}
                  {userOrders.length === 0 && <p className="text-gray-500 text-center py-4">No orders yet.</p>}
              </div>
          </div>
      );
  };

  const SellerDashboard = () => {
    useEffect(() => {
        if (!user) return;
        
        const productsQuery = query(
            collection(db, 'artifacts', appId, 'public', 'data', 'products'), 
            where('sellerId', '==', user.uid)
        );
        const unsubProducts = onSnapshot(productsQuery, (snap) => {
            setMyListings(snap.docs.map(d => ({id: d.id, ...d.data()})));
        });

        const salesQuery = collection(db, 'artifacts', appId, 'users', user.uid, 'sales');
        const unsubSales = onSnapshot(salesQuery, (snap) => {
            setMySales(snap.docs.map(d => ({id: d.id, ...d.data()})));
        });

        return () => { unsubProducts(); unsubSales(); };
    }, []);

    const generateAWB = (saleId) => {
        showToast("Generating Airway Bill...", "success");
        setTimeout(() => {
            alert(`Airway Bill Generated!\n\nTracking Number: MY${Math.floor(Math.random() * 1000000000)}`);
        }, 1000);
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
                    <div className="text-gray-400 text-sm mb-1">Total Sales</div>
                    <div className="text-2xl font-bold text-white">{formatCurrency(mySales.reduce((acc, curr) => acc + (curr.price * curr.qty), 0))}</div>
                </div>
                <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
                    <div className="text-gray-400 text-sm mb-1">Orders To Ship</div>
                    <div className="text-2xl font-bold text-orange-400">{mySales.filter(s => s.status === 'To Ship').length}</div>
                </div>
                <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
                    <div className="text-gray-400 text-sm mb-1">Active Listings</div>
                    <div className="text-2xl font-bold text-cyan-400">{myListings.length}</div>
                </div>
            </div>

            {/* Sales Table */}
            <h2 className="text-xl font-bold text-white mb-4">Incoming Orders</h2>
            <div className="bg-slate-800 rounded-lg overflow-hidden border border-slate-700 mb-8">
                {mySales.length === 0 ? (
                    <div className="p-8 text-center text-gray-500">No sales yet. Keep selling!</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs text-gray-400 uppercase bg-slate-900">
                                <tr>
                                    <th className="px-6 py-3">Product</th>
                                    <th className="px-6 py-3">Buyer</th>
                                    <th className="px-6 py-3">Status</th>
                                    <th className="px-6 py-3">Courier</th>
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
                                            <button onClick={() => generateAWB(sale.id)} className="text-cyan-400 hover:underline flex items-center gap-1">
                                                <Printer size={14}/> Print AWB
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* My Listings */}
            <h2 className="text-xl font-bold text-white mb-4">My Listings</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {myListings.map(item => (
                    <div key={item.id} className="bg-slate-800 p-3 rounded-lg border border-slate-700">
                        <img src={item.images?.[0]} className="w-full h-32 object-cover rounded bg-slate-900 mb-2" />
                        <div className="font-bold text-white line-clamp-1">{item.title}</div>
                        <div className="text-cyan-400 font-bold">{formatCurrency(item.price)}</div>
                        <button className="w-full mt-2 py-1 bg-slate-700 hover:bg-slate-600 rounded text-xs">Edit</button>
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

    useEffect(() => {
      try {
        const q = query(
            collection(db, 'artifacts', appId, 'public', 'data', 'community_posts'),
            orderBy('createdAt', 'desc'),
            limit(50)
        );
        const unsubscribe = onSnapshot(q, (snapshot) => {
            setPosts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        });
        return () => unsubscribe();
      } catch (e) {
        console.log("Firestore error", e);
      }
    }, []);

    const handlePost = async () => {
        if (!user) {
            showToast("Please login to post", "error");
            setView('login');
            return;
        }
        if (!newPost.trim()) return;

        try {
            await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'community_posts'), {
                content: newPost,
                authorId: user.uid,
                authorName: user.displayName || 'Anonymous User',
                createdAt: serverTimestamp(),
                likes: 0
            });
            setNewPost('');
            showToast("Posted to community!");
        } catch (e) {
            showToast("Failed to post", "error");
        }
    };

    return (
        <div className="max-w-4xl mx-auto px-4 py-8 pb-24">
            <h1 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
                <Users className="text-cyan-400" /> RigX Community
            </h1>
            
            {/* Post Input */}
            <div className="bg-slate-800 p-4 rounded-lg mb-6 border border-slate-700">
                <textarea
                    className="w-full bg-slate-900 text-white rounded p-3 border border-slate-700 focus:border-cyan-500 outline-none mb-3 resize-none"
                    rows="3"
                    placeholder="Ask for build advice, share your rig, or discuss tech..."
                    value={newPost}
                    onChange={(e) => setNewPost(e.target.value)}
                />
                <div className="flex justify-end">
                    <button 
                        onClick={handlePost}
                        className="bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2"
                    >
                        <Send size={16} /> Post
                    </button>
                </div>
            </div>

            {/* Feed */}
            <div className="space-y-4">
                {posts.map(post => (
                    <div key={post.id} className="bg-slate-800 p-4 rounded-lg border border-slate-700">
                        <div className="flex justify-between items-start mb-2">
                            <div className="flex items-center gap-2">
                                <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-cyan-500 rounded-full flex items-center justify-center text-xs font-bold text-white">
                                    {post.authorName?.[0]?.toUpperCase() || 'U'}
                                </div>
                                <span className="font-bold text-cyan-400 text-sm">{post.authorName}</span>
                            </div>
                            <span className="text-xs text-gray-500">
                                {post.createdAt?.seconds ? new Date(post.createdAt.seconds * 1000).toLocaleDateString() : 'Just now'}
                            </span>
                        </div>
                        <p className="text-gray-300 text-sm whitespace-pre-wrap ml-10">{post.content}</p>
                    </div>
                ))}
                {posts.length === 0 && (
                    <div className="text-center text-gray-500 py-10 bg-slate-800/30 rounded-lg border border-dashed border-slate-700">
                        No posts yet. Be the first to start a discussion!
                    </div>
                )}
            </div>
        </div>
    );
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
              onChange={(e) => setSearchQuery(e.target.value)}
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
              onChange={(e) => setSearchQuery(e.target.value)}
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
          <h2 className="text-xl font-bold text-white flex items-center gap-2"><Filter size={20} className="text-cyan-400"/> Marketplace</h2>
          
          <div className="flex items-center gap-4 mt-4 md:mt-0">
            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer select-none bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700 hover:border-purple-500 transition-colors">
              <input 
                type="checkbox" 
                checked={showSwapOnly} 
                onChange={(e) => setShowSwapOnly(e.target.checked)}
                className="rounded bg-slate-700 border-slate-600 text-purple-500 focus:ring-purple-500"
              />
              <span className="flex items-center gap-1"><ArrowRightLeft size={14} className="text-purple-400"/> Show Swaps Only</span>
            </label>
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
            {view === 'checkout' && <CheckoutView />}
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
    </div>
  );
}