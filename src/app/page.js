'use client';

import React, { useState, useEffect, useMemo } from 'react';
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
import { 
  ShoppingCart, 
  Search, 
  Menu, 
  User, 
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
  AlertTriangle 
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

// Initialize Analytics safely (client-side only)
let analytics;
if (typeof window !== 'undefined') {
  isSupported().then((supported) => {
    if (supported) {
      analytics = getAnalytics(app);
    }
  }).catch(e => console.log("Analytics not supported in this env"));
}

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

const SPEC_FIELDS = {
  gpu: ['VRAM', 'Chipset', 'Length (mm)'],
  cpu: ['Socket', 'Cores/Threads', 'Base Clock'],
  ram: ['Type (DDR4/5)', 'Speed (MHz)', 'Capacity'],
  monitor: ['Resolution', 'Refresh Rate', 'Panel Type'],
  storage: ['Type (NVMe/SATA)', 'Capacity', 'Read Speed'],
  watercool: ['Radiator Size (mm)', 'Pump Type', 'Tubing Type', 'Fitting Size'], 
};

// Mock Data for Featured Section
const MOCK_FEATURED = [
  {
    id: 'prod_gpu_3070_used', 
    title: 'Used Gigabyte GeForce RTX 3070 Gaming OC 8GB',
    price: 1350.00,
    category: 'gpu',
    brand: 'Gigabyte',
    model: 'RTX 3070 Gaming OC',
    condition: 'Used',
    images: [
      "https://images.unsplash.com/photo-1591488320449-011701bb6704?auto=format&fit=crop&q=80&w=800",
      "https://placehold.co/600x400/222/fff?text=Backplate+View"
    ],
    sellerName: 'RetroTech Hunters',
    sellerId: 'user_v8z9a2m1',
    verifiedSeller: true,
    rating: 4.9,
    listingType: 'sale',
    description: "Letting go of my personal rig GPU. Upgraded to 40-series so this one needs a new home.\n\nCondition: 9/10. Little bit dusty on the fans but heat sink is clean. Never opened, warranty seal still intact.\n\nUsage: Purely gaming (Dota 2, Valorant). Never used for mining. Temps sit around 68-70c on full load.\n\nPrefer COD around One Utama / PJ area.",
    location: 'Petaling Jaya, Selangor',
    specs: {
      "VRAM": "8GB GDDR6",
      "Chipset": "NVIDIA",
      "Length (mm)": "286mm"
    }
  },
  {
    id: 'feat-1',
    title: 'NVIDIA GeForce RTX 4090 Founder Edition',
    price: 8500,
    category: 'gpu',
    condition: 'New',
    images: ['https://images.unsplash.com/photo-1591488320449-011701bb6704?q=80&w=800&auto=format&fit=crop'], 
    sellerName: 'Official Nvidia Store',
    rating: 5.0,
    listingType: 'sale',
    description: 'The ultimate GeForce GPU. A huge leap in performance, efficiency, and AI-powered graphics.',
    location: 'Kuala Lumpur'
  },
  {
    id: 'feat-2',
    title: 'HyperBeast Ultra Gaming PC (RTX 4080)',
    price: 12000,
    category: 'prebuilt',
    condition: 'New',
    images: ['https://images.unsplash.com/photo-1587202372775-e229f172b9d7?q=80&w=800&auto=format&fit=crop'],
    sellerName: 'TechFast Malaysia',
    rating: 4.9,
    listingType: 'both',
    description: 'Custom water cooled loop, Ryzen 9 7950X, 64GB DDR5, 2TB NVMe Gen5.',
    location: 'Selangor'
  },
  {
    id: 'feat-3',
    title: 'Intel Core i9-14900K Processor',
    price: 2800,
    category: 'cpu',
    condition: 'New',
    images: ['https://images.unsplash.com/photo-1591799264318-7e6ef8ddb7ea?q=80&w=800&auto=format&fit=crop'],
    sellerName: 'All IT Hypermarket',
    rating: 4.8,
    listingType: 'sale',
    description: '24 cores (8 P-cores + 16 E-cores) and 32 threads. Up to 6.0 GHz.',
    location: 'Penang'
  },
  {
    id: 'feat-4',
    title: 'G.SKILL Trident Z5 RGB DDR5 32GB',
    price: 650,
    category: 'ram',
    condition: 'Like New',
    images: ['https://images.unsplash.com/photo-1562976540-1502c2145186?q=80&w=800&auto=format&fit=crop'],
    sellerName: 'GamerGuy123',
    rating: 4.5,
    listingType: 'swap',
    description: '6000MT/s CL30. Used for 2 months, swapping for white version.',
    location: 'Johor Bahru'
  }
];

// --- Helper Functions ---
const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(amount);
};

// --- Components ---

const Toast = ({ message, type, onClose }) => (
  <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded shadow-lg animate-fade-in ${
    type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
  }`}>
    {message}
  </div>
);

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
  const [orders, setOrders] = useState([]);
  const [showSwapOnly, setShowSwapOnly] = useState(false);
  const [activeChat, setActiveChat] = useState(null);
  const [configError, setConfigError] = useState(false);
  
  // New State for Recommendations
  const [favorites, setFavorites] = useState(new Set()); 
  const [recentSearches, setRecentSearches] = useState(['gpu', 'gaming']); 

  // Authentication Setup
  useEffect(() => {
    const initAuth = async () => {
      // 1. Check if we have a valid key
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
          // If already signed in, don't sign in anonymously again
          if (!auth.currentUser) {
             await signInAnonymously(auth);
          }
        }
      } catch (e) {
        console.error("Auth Error:", e);
        // We do NOT set configError here if it's just a network issue or auth failure
        // We let the app load in a "guest" state if auth fails
        setLoading(false);
      }
    };

    initAuth();
    
    // Only set up listener
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
    if (!user || configError) return;
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
  }, [user, configError]);

  // Track Recent Searches
  useEffect(() => {
    if (searchQuery.length > 3 && !recentSearches.includes(searchQuery.toLowerCase())) {
        const timeoutId = setTimeout(() => {
             setRecentSearches(prev => [searchQuery.toLowerCase(), ...prev].slice(0, 5));
        }, 1500); // Debounce
        return () => clearTimeout(timeoutId);
    }
  }, [searchQuery]);

  const showToast = (msg, type = 'success') => {
    setToast({ message: msg, type });
    setTimeout(() => setToast(null), 3000);
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
      setView('home');
    } catch (e) {
      showToast('Error publishing listing: ' + e.message, 'error');
    }
  };

  const handleCheckout = async (address, paymentMethod) => {
    if (configError) { showToast("Checkout disabled", "error"); return; }
    if (!user || cart.length === 0) return;
    try {
      const orderData = {
        buyerId: user.uid,
        items: cart,
        total: cart.reduce((sum, item) => sum + (item.price * item.qty), 0),
        status: 'Paid', 
        address,
        paymentMethod,
        createdAt: serverTimestamp()
      };
      await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'orders'), orderData);
      setCart([]);
      showToast('Order placed successfully! Redirecting...');
      setTimeout(() => setView('profile'), 1500);
    } catch (e) {
      console.error(e);
      showToast('Checkout failed', 'error');
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

  // Featured items
  const featuredProducts = useMemo(() => {
     const realFeatured = [...products].sort((a,b) => b.price - a.price).slice(0, 4);
     
     // Mix: Top 2 real, Top 2 mock to ensure display even without DB
     return [...realFeatured.slice(0, 2), ...MOCK_FEATURED.slice(0, 4 - realFeatured.length)];
  }, [products]);

  // Recommended Items Logic
  const recommendedProducts = useMemo(() => {
     // Use mock products if DB is empty to show how it looks
     const sourceProducts = products.length > 0 ? products : MOCK_FEATURED;
     
     const favCategories = new Set();
     // If no favorites, simulate some recommendations
     if (favorites.size === 0) return sourceProducts.slice(0, 4);

     sourceProducts.forEach(p => {
         if (favorites.has(p.id)) favCategories.add(p.category);
     });

     return sourceProducts.filter(p => {
         const matchesFavCategory = favCategories.has(p.category);
         const matchesRecentSearch = recentSearches.some(term => 
             p.title.toLowerCase().includes(term) || p.category.includes(term)
         );
         return matchesFavCategory || matchesRecentSearch;
     }).slice(0, 8); 
  }, [products, favorites, recentSearches]);

  // --- Sub-Components (Views) ---

  const Navbar = () => (
    <nav className="bg-slate-900 border-b border-slate-800 sticky top-0 z-40 shadow-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => setView('home')}>
            <div className="bg-cyan-500 p-1.5 rounded shadow shadow-cyan-500/50">
              <Zap className="text-white h-5 w-5" />
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-xl tracking-wider text-white leading-none">
                RigX<span className="text-cyan-400">.my</span>
              </span>
              <span className="text-[10px] text-gray-400 font-medium tracking-wide uppercase leading-tight mt-1">
                by Genius Advanced
              </span>
            </div>
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
            {user && !user.isAnonymous ? (
               <button onClick={() => setView('profile')} className="p-2 text-gray-300 hover:text-white">
                 <User className="h-6 w-6" />
               </button>
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
    <div className="md:hidden fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-800 flex justify-around p-3 z-50">
      <button onClick={() => setView('home')} className={`flex flex-col items-center ${view === 'home' ? 'text-cyan-400' : 'text-gray-500'}`}>
        <Home size={20} />
        <span className="text-xs mt-1">Home</span>
      </button>
      <button onClick={() => setView('sell')} className={`flex flex-col items-center ${view === 'sell' ? 'text-cyan-400' : 'text-gray-500'}`}>
        <PlusCircle size={20} />
        <span className="text-xs mt-1">Sell</span>
      </button>
      <button onClick={() => setView('chat')} className={`flex flex-col items-center ${view === 'chat' ? 'text-cyan-400' : 'text-gray-500'}`}>
        <MessageSquare size={20} />
        <span className="text-xs mt-1">Chat</span>
      </button>
      <button onClick={() => setView('profile')} className={`flex flex-col items-center ${view === 'profile' ? 'text-cyan-400' : 'text-gray-500'}`}>
        <User size={20} />
        <span className="text-xs mt-1">Me</span>
      </button>
    </div>
  );

  const FeaturedSection = () => (
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
                src={product.images?.[0]} 
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
  );

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

  const HomeView = () => (
    <div className="pb-20">
      {/* Configuration Error Banner */}
      {configError && (
        <div className="bg-orange-600/90 text-white text-sm p-3 text-center flex items-center justify-center gap-2 backdrop-blur-sm sticky top-16 z-30">
          <AlertTriangle size={16} />
          <span><b>Local Preview Mode:</b> Firebase API Key is missing. Login & Checkout are disabled.</span>
        </div>
      )}

      {/* Hero */}
      <div className="relative bg-gradient-to-r from-purple-900 to-slate-900 overflow-hidden mb-8">
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-30"></div>
        <div className="relative max-w-7xl mx-auto p-8 md:p-16 flex flex-col md:flex-row items-center justify-between">
          <div className="text-center md:text-left mb-8 md:mb-0 z-10">
            <h1 className="text-4xl md:text-6xl font-extrabold text-white mb-4 leading-tight">
              TRADE. SWAP. <br/>
              <span className="text-cyan-400 text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-500">UPGRADE.</span>
            </h1>
            <p className="text-gray-300 mb-6 max-w-xl text-lg">
              Malaysia's premier marketplace for PC enthusiasts. Find rare parts, swap your old rig, or buy your dream setup.
            </p>
            <div className="flex gap-4 justify-center md:justify-start">
              <button onClick={() => { setSelectedCategory('gpu'); window.scrollTo(0, 800); }} className="px-8 py-3 bg-cyan-500 hover:bg-cyan-600 text-white font-bold rounded-lg shadow-lg shadow-cyan-500/30 transition-all transform hover:-translate-y-1">
                Browse Parts
              </button>
              <button onClick={() => { setShowSwapOnly(true); window.scrollTo(0, 800); }} className="px-8 py-3 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-lg shadow-lg shadow-purple-600/30 flex items-center gap-2 transition-all transform hover:-translate-y-1">
                <Repeat size={18}/> Find Swaps
              </button>
            </div>
          </div>
          {/* Decorative Element */}
          <div className="hidden md:block w-64 h-64 bg-cyan-500/20 rounded-full blur-3xl absolute right-10 top-10 animate-pulse"></div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4">
        
        <FeaturedSection />

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

        {/* NEW: Recommended For You Section */}
        <RecommendedSection />

        {/* Product Grid */}
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
                </div>
              )}
            </div>
        </div>
      </div>
    </div>
  );

  const ProductDetailView = () => {
    if (!selectedProduct) return null;
    const isSwapAvailable = selectedProduct.listingType === 'swap' || selectedProduct.listingType === 'both';

    return (
      <div className="max-w-7xl mx-auto px-4 py-6 pb-24 text-gray-200">
        <button onClick={() => setView('home')} className="mb-4 flex items-center gap-2 text-cyan-400 text-sm hover:underline font-medium">
          <Home size={16} /> Back to Marketplace
        </button>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Images */}
          <div className="space-y-4">
            <div className="bg-slate-800 rounded-xl p-2 border border-slate-700 relative">
              <img 
                src={selectedProduct.images?.[0]} 
                className="w-full rounded-lg object-contain bg-slate-900 aspect-[4/3]"
                alt={selectedProduct.title}
              />
              <button 
                  onClick={(e) => toggleFavorite(e, selectedProduct.id)}
                  className="absolute top-4 right-4 p-3 bg-slate-900/50 rounded-full hover:bg-slate-800 transition-colors"
                >
                  <Heart size={24} className={favorites.has(selectedProduct.id) ? "fill-red-500 text-red-500" : "text-white"} />
              </button>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-2">
               {selectedProduct.images?.map((img, i) => (
                 <img key={i} src={img} className="w-20 h-20 rounded border border-slate-700 object-cover cursor-pointer hover:border-cyan-400 transition-colors"/>
               ))}
            </div>
          </div>
  
          {/* Info */}
          <div>
            <div className="flex items-start justify-between">
               <div>
                  <h1 className="text-2xl md:text-3xl font-bold text-white mb-2 leading-tight">{selectedProduct.title}</h1>
                  <div className="flex flex-wrap items-center gap-3 mb-6 text-sm">
                     <span className="bg-slate-700 px-2 py-1 rounded text-cyan-300 font-medium">{selectedProduct.condition}</span>
                     {isSwapAvailable && <span className="bg-purple-900/50 border border-purple-500 px-2 py-1 rounded text-purple-300 font-bold flex items-center gap-1"><Repeat size={12}/> Accepts Swap</span>}
                     <span className="flex items-center gap-1 text-yellow-400"><Star size={14} fill="currentColor"/> {selectedProduct.rating || 5.0} (Seller Rating)</span>
                  </div>
               </div>
            </div>
  
            <div className="text-4xl font-extrabold text-cyan-400 mb-8">{formatCurrency(selectedProduct.price)}</div>
  
            <div className="grid grid-cols-2 gap-4 mb-4">
              <button 
                onClick={() => handleAddToCart(selectedProduct)}
                className="flex items-center justify-center gap-2 py-3 border-2 border-cyan-500 text-cyan-400 font-bold rounded-lg hover:bg-cyan-500/10 transition-colors"
              >
                <ShoppingCart size={20}/> Add to Cart
              </button>
              <button 
                 onClick={() => { handleAddToCart(selectedProduct); setView('cart'); }}
                 className="flex items-center justify-center gap-2 py-3 bg-cyan-600 text-white font-bold rounded-lg hover:bg-cyan-500 transition-all shadow-lg shadow-cyan-600/20"
              >
                Buy Now
              </button>
            </div>

            {isSwapAvailable && (
              <button 
                onClick={() => startChat(selectedProduct.sellerId, `Swap Inquiry: ${selectedProduct.title}`, "Hi! I'm interested in swapping for your item. Is it still available?")}
                className="w-full mb-6 flex items-center justify-center gap-2 py-3 bg-purple-600 text-white font-bold rounded-lg hover:bg-purple-500 transition-all shadow-lg shadow-purple-600/20"
              >
                <ArrowRightLeft size={20}/> Propose Swap / Trade
              </button>
            )}

            {isSwapAvailable && selectedProduct.lookingFor && (
               <div className="bg-purple-900/20 border border-purple-500/30 p-4 rounded-lg mb-6">
                 <h4 className="text-purple-300 font-bold text-sm mb-1">Seller is looking for:</h4>
                 <p className="text-gray-300 text-sm">{selectedProduct.lookingFor}</p>
               </div>
            )}
            
            {!isSwapAvailable && (
               <button onClick={() => startChat(selectedProduct.sellerId, selectedProduct.title)} className="w-full mb-8 flex items-center justify-center gap-2 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm font-medium">
                <MessageSquare size={16}/> Chat with Seller
              </button>
            )}
  
            <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
              <h3 className="font-bold text-lg text-white mb-4 border-b border-slate-700 pb-2">Product Specifications</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between py-1 border-b border-slate-700/50">
                  <span className="text-gray-400">Category</span>
                  <span>{CATEGORIES.find(c => c.id === selectedProduct.category)?.name}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-700/50">
                  <span className="text-gray-400">Brand</span>
                  <span>{selectedProduct.brand}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-700/50">
                  <span className="text-gray-400">Model</span>
                  <span>{selectedProduct.model}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-700/50">
                  <span className="text-gray-400">Location</span>
                  <span>{selectedProduct.location}</span>
                </div>
                {/* Dynamic Specs */}
                {selectedProduct.specs && Object.entries(selectedProduct.specs).map(([key, val]) => (
                   <div key={key} className="flex justify-between py-1 border-b border-slate-700/50">
                    <span className="text-gray-400">{key}</span>
                    <span>{val}</span>
                  </div>
                ))}
              </div>
              
              <h3 className="font-bold text-lg text-white mt-8 mb-4 border-b border-slate-700 pb-2">Description</h3>
              <p className="text-gray-300 leading-relaxed whitespace-pre-line">
                {selectedProduct.description}
              </p>
            </div>
          </div>
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
            <label className="block text-sm mb-1 text-gray-400">Image URL</label>
            <input type="text" className="w-full bg-slate-900 border border-slate-700 rounded p-2 focus:border-cyan-500 outline-none" placeholder="http://..." value={form.image} onChange={e => setForm({...form, image: e.target.value})}/>
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

  const CartView = () => (
    <div className="max-w-4xl mx-auto px-4 py-8 pb-24">
      <h1 className="text-2xl font-bold text-white mb-6">Shopping Cart ({cart.length})</h1>
      {cart.length === 0 ? (
        <div className="text-center py-20 bg-slate-800 rounded-lg">
           <ShoppingCart className="mx-auto h-12 w-12 text-gray-500 mb-4"/>
           <p className="text-gray-400">Your cart is empty.</p>
           <button onClick={() => setView('home')} className="mt-4 text-cyan-400 hover:underline">Go Shopping</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="md:col-span-2 space-y-4">
             {cart.map(item => (
               <div key={item.id} className="bg-slate-800 p-4 rounded-lg flex gap-4">
                 <img src={item.images?.[0]} className="w-20 h-20 object-cover rounded bg-slate-900" />
                 <div className="flex-1">
                   <h3 className="text-white font-medium line-clamp-1">{item.title}</h3>
                   <p className="text-gray-400 text-sm">{item.brand}</p>
                   <div className="mt-2 flex items-center justify-between">
                     <span className="text-cyan-400 font-bold">{formatCurrency(item.price)}</span>
                     <button onClick={() => removeFromCart(item.id)} className="text-red-400 hover:text-red-300">
                       <Trash2 size={18} />
                     </button>
                   </div>
                 </div>
               </div>
             ))}
          </div>
          
          <div className="bg-slate-800 p-6 rounded-lg h-fit">
            <h3 className="text-white font-bold mb-4">Order Summary</h3>
            <div className="flex justify-between text-gray-400 mb-2">
              <span>Subtotal</span>
              <span>{formatCurrency(cart.reduce((s, i) => s + (i.price * i.qty), 0))}</span>
            </div>
            <div className="flex justify-between text-gray-400 mb-4">
              <span>Shipping</span>
              <span>RM 10.00</span>
            </div>
            <div className="flex justify-between text-white font-bold text-xl border-t border-slate-700 pt-4 mb-6">
              <span>Total</span>
              <span>{formatCurrency(cart.reduce((s, i) => s + (i.price * i.qty), 0) + 10)}</span>
            </div>
            <button onClick={() => setView('checkout')} className="w-full py-3 bg-cyan-600 text-white font-bold rounded hover:bg-cyan-500">
              Proceed to Checkout
            </button>
          </div>
        </div>
      )}
    </div>
  );

  const CheckoutView = () => {
    const [address, setAddress] = useState('');
    const [payMethod, setPayMethod] = useState('fpx'); 

    return (
      <div className="max-w-2xl mx-auto px-4 py-8 pb-24 text-gray-200">
        <h1 className="text-2xl font-bold text-white mb-6">Checkout</h1>
        
        <div className="bg-slate-800 p-6 rounded-lg mb-6 border border-slate-700">
          <h2 className="font-bold text-white mb-4 flex items-center gap-2"><Truck size={20}/> Delivery Address</h2>
          <textarea 
            className="w-full bg-slate-900 border border-slate-700 rounded p-3 text-white focus:border-cyan-500 outline-none"
            rows="3"
            placeholder="No. 123, Jalan Tech, 50000 Kuala Lumpur..."
            value={address}
            onChange={e => setAddress(e.target.value)}
          ></textarea>
        </div>

        <div className="bg-slate-800 p-6 rounded-lg mb-6 border border-slate-700">
          <h2 className="font-bold text-white mb-4 flex items-center gap-2"><CreditCard size={20}/> Payment Method</h2>
          <div className="grid grid-cols-2 gap-4">
            <div 
              onClick={() => setPayMethod('fpx')}
              className={`p-4 border rounded cursor-pointer flex flex-col items-center gap-2 transition-colors ${payMethod === 'fpx' ? 'border-cyan-500 bg-cyan-900/20' : 'border-slate-700 hover:bg-slate-700'}`}
            >
              <div className="font-bold text-white">FPX / ToyyibPay</div>
              <span className="text-xs text-gray-400">Online Banking</span>
            </div>
            <div 
              onClick={() => setPayMethod('card')}
              className={`p-4 border rounded cursor-pointer flex flex-col items-center gap-2 transition-colors ${payMethod === 'card' ? 'border-cyan-500 bg-cyan-900/20' : 'border-slate-700 hover:bg-slate-700'}`}
            >
              <div className="font-bold text-white">Credit Card</div>
              <span className="text-xs text-gray-400">Stripe / Visa / Master</span>
            </div>
          </div>
        </div>

        <button 
          onClick={() => handleCheckout(address, payMethod)}
          className="w-full py-4 bg-gradient-to-r from-purple-600 to-cyan-600 text-white font-bold rounded shadow-lg hover:opacity-90 transition-opacity"
        >
          Pay {formatCurrency(cart.reduce((s, i) => s + (i.price * i.qty), 0) + 10)}
        </button>
      </div>
    );
  };

  const AuthView = ({ mode }) => { 
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');

    const handleAuth = async () => {
      try {
        if (mode === 'register') {
          const res = await createUserWithEmailAndPassword(auth, email, password);
          await updateProfile(res.user, { displayName: name });
        } else {
          await signInWithEmailAndPassword(auth, email, password);
        }
        setView('home');
      } catch (e) {
        showToast(e.message, 'error');
      }
    };

    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] px-4">
        <div className="bg-slate-800 p-8 rounded-lg w-full max-w-md border border-slate-700">
          <h2 className="text-2xl font-bold text-white mb-6 text-center">{mode === 'login' ? 'Welcome Back' : 'Join RigX.my'}</h2>
          
          {mode === 'register' && (
            <input type="text" placeholder="Display Name" className="w-full mb-4 bg-slate-900 border border-slate-700 rounded p-3 text-white" value={name} onChange={e => setName(e.target.value)} />
          )}
          <input type="email" placeholder="Email" className="w-full mb-4 bg-slate-900 border border-slate-700 rounded p-3 text-white" value={email} onChange={e => setEmail(e.target.value)} />
          <input type="password" placeholder="Password" className="w-full mb-6 bg-slate-900 border border-slate-700 rounded p-3 text-white" value={password} onChange={e => setPassword(e.target.value)} />
          
          <button onClick={handleAuth} className="w-full py-3 bg-gradient-to-r from-cyan-600 to-blue-600 text-white font-bold rounded mb-4 hover:opacity-90">
            {mode === 'login' ? 'Login' : 'Register'}
          </button>
          
          <p className="text-center text-gray-400 text-sm">
            {mode === 'login' ? "Don't have an account?" : "Already have an account?"} 
            <button className="text-cyan-400 ml-2 font-bold" onClick={() => setView(mode === 'login' ? 'register' : 'login')}>
               {mode === 'login' ? 'Sign Up' : 'Login'}
            </button>
          </p>
        </div>
      </div>
    );
  };

  const ProfileView = () => {
    useEffect(() => {
       if(!user) return;
       try {
           const q = collection(db, 'artifacts', appId, 'users', user.uid, 'orders');
           const unsub = onSnapshot(q, (snap) => {
             setOrders(snap.docs.map(d => ({id: d.id, ...d.data()})));
           });
           return () => unsub();
       } catch (e) {
           console.log("Firestore error or offline");
       }
    }, [user]);

    if (!user || user.isAnonymous) return (
      <div className="p-8 text-center text-gray-400">Please login to view profile.</div>
    );

    return (
      <div className="max-w-4xl mx-auto px-4 py-8 pb-24 text-gray-200">
        <div className="bg-slate-800 p-6 rounded-lg flex items-center gap-4 mb-8 border border-slate-700">
           <div className="w-16 h-16 bg-gradient-to-br from-cyan-400 to-purple-500 rounded-full flex items-center justify-center text-2xl font-bold text-white uppercase">
              {user.displayName?.[0] || 'U'}
           </div>
           <div>
             <h2 className="text-xl font-bold text-white">{user.displayName}</h2>
             <p className="text-gray-400 text-sm">{user.email}</p>
             <button onClick={() => { signOut(auth); setView('home'); }} className="text-red-400 text-sm mt-1 hover:underline">Logout</button>
           </div>
        </div>

        <h3 className="text-lg font-bold text-white mb-4 border-b border-slate-700 pb-2">Order History</h3>
        <div className="space-y-4">
           {orders.length === 0 && <p className="text-gray-500">No orders yet.</p>}
           {orders.map(order => (
             <div key={order.id} className="bg-slate-800 p-4 rounded border border-slate-700">
                <div className="flex justify-between mb-2">
                   <span className="text-cyan-400 font-bold">#{order.id.slice(0, 8)}</span>
                   <span className="text-green-400 text-sm font-bold bg-green-400/10 px-2 py-0.5 rounded">{order.status}</span>
                </div>
                <div className="text-sm text-gray-400 mb-2">
                  {new Date(order.createdAt?.seconds * 1000).toLocaleDateString()}
                </div>
                <div className="space-y-2">
                   {order.items.map((item, idx) => (
                      <div key={idx} className="flex justify-between text-sm">
                         <span>{item.title} (x{item.qty})</span>
                         <span>{formatCurrency(item.price * item.qty)}</span>
                      </div>
                   ))}
                </div>
                <div className="border-t border-slate-700 mt-2 pt-2 flex justify-between font-bold text-white">
                   <span>Total</span>
                   <span>{formatCurrency(order.total)}</span>
                </div>
             </div>
           ))}
        </div>
      </div>
    );
  };

  const ChatView = () => (
    <div className="max-w-2xl mx-auto px-4 py-8 h-[calc(100vh-64px)] flex flex-col">
       <button onClick={() => setView('home')} className="mb-4 flex items-center gap-2 text-cyan-400 text-sm hover:underline self-start">
         <Home size={16} /> Back
       </button>
       <div className="bg-slate-800 border border-slate-700 rounded-lg flex-1 flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-700 bg-slate-900">
             <h2 className="font-bold text-white">{activeChat ? activeChat.subject : 'Chat'}</h2>
             <p className="text-xs text-gray-400">Trading safely protects everyone.</p>
          </div>
          <div className="flex-1 p-4 overflow-y-auto space-y-4 bg-slate-800">
             {activeChat && activeChat.messages.map((m, i) => (
                <div key={i} className={`flex flex-col ${m.sender === (user?.displayName || 'guest') ? 'items-end' : 'items-start'}`}>
                   <div className={`max-w-[80%] p-3 rounded-lg text-sm ${m.sender === (user?.displayName || 'guest') ? 'bg-cyan-600 text-white rounded-tr-none' : 'bg-slate-700 text-gray-200 rounded-tl-none'}`}>
                      {m.text}
                   </div>
                   <span className="text-[10px] text-gray-500 mt-1">{m.sender}</span>
                </div>
             ))}
             {(!activeChat || activeChat.messages.length === 0) && (
               <div className="text-center text-gray-500 mt-10">Start the conversation...</div>
             )}
          </div>
          <div className="p-3 bg-slate-900 border-t border-slate-700 flex gap-2">
             <input type="text" placeholder="Type a message..." className="flex-1 bg-slate-800 text-white rounded px-3 py-2 border border-slate-700 focus:border-cyan-500 outline-none"/>
             <button className="bg-cyan-600 p-2 rounded text-white"><ArrowRightLeft size={20}/></button>
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
            {view === 'product' && selectedProduct && <ProductDetailView />}
            {view === 'cart' && <CartView />}
            {view === 'checkout' && <CheckoutView />}
            {view === 'sell' && <SellView />}
            {view === 'login' && <AuthView mode="login" />}
            {view === 'register' && <AuthView mode="register" />}
            {view === 'profile' && <ProfileView />}
            {view === 'chat' && <ChatView />}
          </>
        )}
      </main>

      {/* Floating Help Button */}
      <button 
        onClick={handleSupportClick}
        className="fixed bottom-20 right-4 md:bottom-8 md:right-8 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white p-3 rounded-full shadow-lg shadow-cyan-600/40 z-50 transition-all hover:scale-105 flex items-center gap-2 group border border-cyan-400/50"
      >
        <MessageCircleQuestion size={28} />
        <span className="max-w-0 overflow-hidden group-hover:max-w-xs transition-all duration-300 ease-in-out whitespace-nowrap text-sm font-bold pl-0 group-hover:pl-2">
          Ask RigX
        </span>
      </button>

      <BottomNav />
    </div>
  );
}