import React, { useState, useEffect, useRef } from 'react';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signOut } from 'firebase/auth';
import {
  getFirestore, collection, addDoc, getDocs, query, where,
  updateDoc, doc, getDoc, setDoc
} from 'firebase/firestore';
import {
  format, startOfWeek, addDays, isSameDay, subDays, isBefore, startOfDay
} from 'date-fns';
import {
  Home, BookOpen, Settings, Swords, ChevronLeft, Plus,
  Check, Circle, Send, Sparkles, Trophy, Calendar, Target,
  Flame, Key, LogOut
} from 'lucide-react';

// ==========================================
// AI & FIREBASE CONFIGURATION
// ==========================================
// If these are empty, the app will show a setup screen asking for them,
// saving them to localStorage so the user can easily test the app.
const INITIAL_FIREBASE_CONFIG = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

const INITIAL_GEMINI_KEY = "";

// ==========================================
// UTILS & DB ABSTRACTION
// ==========================================
const XP_PER_TASK = 30;
const XP_PER_LEVEL = 900;

function calculateLevel(totalXp) {
  const level = Math.floor(totalXp / XP_PER_LEVEL) + 1;
  const currentLevelXp = totalXp % XP_PER_LEVEL;
  const progressPercent = (currentLevelXp / XP_PER_LEVEL) * 100;
  return { level, currentLevelXp, progressPercent, nextLevelXp: XP_PER_LEVEL };
}

const romanize = (num) => {
  if (num === 0) return "";
  const lookup = { M: 1000, CM: 900, D: 500, CD: 400, C: 100, XC: 90, L: 50, XL: 40, X: 10, IX: 9, V: 5, IV: 4, I: 1 };
  let roman = '';
  for (let i in lookup) {
    while (num >= lookup[i]) {
      roman += i;
      num -= lookup[i];
    }
  }
  return roman;
};

// ==========================================
// MAIN APPLICATION
// ==========================================
export default function App() {
  const [isConfigured, setIsConfigured] = useState(false);
  const [firebaseConfig, setFirebaseConfig] = useState(INITIAL_FIREBASE_CONFIG);
  const [geminiKey, setGeminiKey] = useState(INITIAL_GEMINI_KEY);
  const [configError, setConfigError] = useState("");

  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);

  const [user, setUser] = useState(null);
  const [xp, setXp] = useState(0);
  const [tasks, setTasks] = useState([]);
  const [topics, setTopics] = useState([]);

  const [currentView, setCurrentView] = useState('home'); // home, more, topic, settings
  const [selectedTopic, setSelectedTopic] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load config from localStorage
  useEffect(() => {
    const storedFb = localStorage.getItem('progress_fb_config');
    const storedGemini = localStorage.getItem('progress_gemini_key');

    let fbParsed = { ...INITIAL_FIREBASE_CONFIG };
    try {
      if (storedFb) fbParsed = JSON.parse(storedFb);
    } catch (e) { }

    if (fbParsed.apiKey && storedGemini) {
      setFirebaseConfig(fbParsed);
      setGeminiKey(storedGemini);
      initializeBacked(fbParsed);
    } else {
      setIsLoading(false);
    }
  }, []);

  const initializeBacked = async (config) => {
    try {
      let app;
      if (!getApps().length) {
        app = initializeApp(config);
      } else {
        app = getApps()[0];
      }
      const firebaseAuth = getAuth(app);
      const firestoreDb = getFirestore(app);

      setAuth(firebaseAuth);
      setDb(firestoreDb);

      onAuthStateChanged(firebaseAuth, async (userObj) => {
        if (userObj) {
          setUser(userObj);
          await loadUserData(userObj.uid, firestoreDb);
          setIsConfigured(true);
        } else {
          try {
            await signInAnonymously(firebaseAuth);
          } catch (e) {
            console.error("Auth error", e);
            setConfigError("Failed to authenticate anonymously. Check Firebase Config.");
          }
        }
        setIsLoading(false);
      });
    } catch (err) {
      console.error(err);
      setConfigError("Failed to initialize Firebase. Please check your configuration.");
      setIsLoading(false);
      localStorage.removeItem('progress_fb_config');
    }
  };

  const loadUserData = async (uid, database) => {
    setIsLoading(true);
    try {
      // Load Profile
      const profileRef = doc(database, "users", uid);
      const profileSnap = await getDoc(profileRef);
      if (profileSnap.exists()) {
        setXp(profileSnap.data().xp || 0);
      } else {
        await setDoc(profileRef, { xp: 0 });
      }

      // Load Tasks
      const tasksQuery = query(collection(database, "tasks"), where("userId", "==", uid));
      const tasksSnap = await getDocs(tasksQuery);
      setTasks(tasksSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      // Load Topics
      const topicsQuery = query(collection(database, "topics"), where("userId", "==", uid));
      const topicsSnap = await getDocs(topicsQuery);
      setTopics(topicsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error("Error loading data:", e);
    } finally {
      setIsLoading(false);
    }
  };

  const saveConfig = (newFbConfig, newGeminiKey) => {
    localStorage.setItem('progress_fb_config', JSON.stringify(newFbConfig));
    localStorage.setItem('progress_gemini_key', newGeminiKey);
    setFirebaseConfig(newFbConfig);
    setGeminiKey(newGeminiKey);
    setIsLoading(true);
    initializeBacked(newFbConfig);
  };

  const handleLogout = () => {
    if (auth) signOut(auth);
    localStorage.removeItem('progress_fb_config');
    localStorage.removeItem('progress_gemini_key');
    setIsConfigured(false);
    setUser(null);
    setTasks([]);
    setTopics([]);
  };

  // ---- APP ACTIONS ----
  const addTask = async (title, dateStr, topicId = null) => {
    if (!user || !db) return;
    const newTask = {
      userId: user.uid,
      title,
      date: dateStr,
      topicId,
      completed: false,
      createdAt: new Date().toISOString()
    };
    const docRef = await addDoc(collection(db, "tasks"), newTask);
    setTasks([...tasks, { id: docRef.id, ...newTask }]);
  };

  const toggleTaskCompletion = async (taskId, currentStatus) => {
    if (!user || !db) return;
    const newStatus = !currentStatus;

    // Optimistic update
    setTasks(tasks.map(t => t.id === taskId ? { ...t, completed: newStatus } : t));

    // XP update
    let newXp = xp;
    if (newStatus) newXp += XP_PER_TASK;
    // else newXp = Math.max(0, newXp - XP_PER_TASK); // uncomment to penalize unchecking
    setXp(newXp);

    // Sync to DB
    try {
      await updateDoc(doc(db, "tasks", taskId), { completed: newStatus });
      await updateDoc(doc(db, "users", user.uid), { xp: newXp });
    } catch (e) {
      console.error("Error updating task", e);
    }
  };

  const addTopic = async (title) => {
    if (!user || !db) return;
    const newTopic = {
      userId: user.uid,
      title,
      createdAt: new Date().toISOString()
    };
    const docRef = await addDoc(collection(db, "topics"), newTopic);
    setTopics([...topics, { id: docRef.id, ...newTopic }]);
  };

  // ---- RENDER VIEWS ----
  if (isLoading) {
    return (
      <div className="min-h-screen bg-parchment-50 flex items-center justify-center">
        <div className="animate-spin text-gold-500"><Sparkles size={48} /></div>
      </div>
    );
  }

  if (!isConfigured) {
    return <SetupScreen onSave={saveConfig} error={configError} />;
  }

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-parchment-50 font-sans text-espresso-900 selection:bg-gold-500 selection:text-white pb-20 md:pb-0">
      <Sidebar
        currentView={currentView} setCurrentView={setCurrentView}
        xp={xp} levelData={calculateLevel(xp)}
        onLogout={handleLogout}
      />

      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        <Header xp={xp} levelData={calculateLevel(xp)} />
        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          {currentView === 'home' && (
            <HomeView tasks={tasks} toggleTaskCompletion={toggleTaskCompletion} addTask={addTask} xp={xp} />
          )}
          {currentView === 'more' && (
            <MoreView topics={topics} addTopic={addTopic} onViewTopic={(topic) => {
              setSelectedTopic(topic);
              setCurrentView('topic');
            }} />
          )}
          {currentView === 'topic' && selectedTopic && (
            <TopicDetailsView
              topic={selectedTopic}
              onBack={() => setCurrentView('more')}
              geminiKey={geminiKey}
            />
          )}
          {currentView === 'settings' && (
            <div className="max-w-2xl mx-auto space-y-8 animate-fade-in">
              <h2 className="text-3xl font-serif font-bold text-espresso-900">Settings</h2>
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-espresso-100/50">
                <button
                  onClick={handleLogout}
                  className="w-full py-4 rounded-xl flex items-center justify-center gap-2 bg-red-50 text-red-600 font-medium hover:bg-red-100 transition-colors"
                >
                  <LogOut size={20} />
                  Sign Out & Clear Configuration
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-espresso-900 text-espresso-100 p-4 pb-safe flex justify-around items-center z-50 shadow-[0_-4px_20px_rgba(0,0,0,0.1)] rounded-t-3xl">
        <button
          onClick={() => setCurrentView('home')}
          className={`flex flex-col items-center gap-1 transition-colors ${currentView === 'home' ? 'text-gold-400' : 'text-espresso-300 hover:text-white'}`}
        >
          <Home size={24} />
          <span className="text-[10px] uppercase font-semibold tracking-wider">Dashboard</span>
        </button>
        <button
          onClick={() => setCurrentView('more')}
          className={`flex flex-col items-center gap-1 transition-colors ${['more', 'topic'].includes(currentView) ? 'text-gold-400' : 'text-espresso-300 hover:text-white'}`}
        >
          <BookOpen size={24} />
          <span className="text-[10px] uppercase font-semibold tracking-wider">Subjects</span>
        </button>
        <button
          onClick={() => setCurrentView('settings')}
          className={`flex flex-col items-center gap-1 transition-colors ${currentView === 'settings' ? 'text-gold-400' : 'text-espresso-300 hover:text-white'}`}
        >
          <Settings size={24} />
          <span className="text-[10px] uppercase font-semibold tracking-wider">Settings</span>
        </button>
      </nav>
    </div>
  );
}

// ==========================================
// COMPONENTS
// ==========================================

function SetupScreen({ onSave, error }) {
  const [fbConfigText, setFbConfigText] = useState(JSON.stringify(INITIAL_FIREBASE_CONFIG, null, 2));
  const [geminiKey, setGeminiKey] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    try {
      const parsedFb = JSON.parse(fbConfigText);
      onSave(parsedFb, geminiKey);
    } catch (err) {
      alert("Invalid JSON for Firebase Config");
    }
  };

  return (
    <div className="min-h-screen bg-espresso-950 flex flex-col items-center justify-center p-6 text-parchment-50 font-sans">
      <div className="w-full max-w-xl bg-espresso-900 rounded-3xl p-8 shadow-2xl border border-gold-500/20 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 text-gold-500/10 pointer-events-none">
          <BookOpen size={200} />
        </div>

        <h1 className="text-4xl font-serif font-bold text-gold-400 mb-2 flex items-center gap-3 relative z-10">
          <Sparkles className="text-gold-500" /> PROGRESS
        </h1>
        <p className="text-espresso-200 mb-8 relative z-10">
          Welcome to your personalized learning odyssey. Please configure your powerful tools to begin your journey.
        </p>

        {error && <div className="mb-6 p-4 bg-red-900/50 text-red-200 rounded-xl border border-red-500/50 text-sm font-medium">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-6 relative z-10">
          <div>
            <label className="block text-sm font-semibold text-gold-400 mb-2 uppercase tracking-wide flex items-center gap-2">
              <Key size={16} /> Firebase Configuration (JSON)
            </label>
            <textarea
              value={fbConfigText}
              onChange={(e) => setFbConfigText(e.target.value)}
              className="w-full h-48 bg-espresso-950 border border-espresso-700 rounded-xl p-4 text-espresso-100 font-mono text-sm focus:outline-none focus:border-gold-500 transition-colors"
            />
            <p className="text-xs text-espresso-400 mt-2">Paste your Firebase web app config object here (as valid JSON).</p>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gold-400 mb-2 uppercase tracking-wide flex items-center gap-2">
              <Target size={16} /> Gemini AI API Key
            </label>
            <input
              type="password"
              value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
              required
              className="w-full bg-espresso-950 border border-espresso-700 rounded-xl p-4 text-espresso-100 focus:outline-none focus:border-gold-500 transition-colors"
              placeholder="AIzaSy..."
            />
            <p className="text-xs text-espresso-400 mt-2">Get an API key from Google AI Studio.</p>
          </div>
          <button
            type="submit"
            className="w-full py-4 bg-gradient-to-r from-gold-500 to-gold-400 text-espresso-950 rounded-xl font-bold text-lg shadow-lg hover:shadow-gold-500/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
          >
            Start Your Journey <ChevronLeft className="rotate-180" size={20} />
          </button>
        </form>
      </div>
    </div>
  );
}

function Sidebar({ currentView, setCurrentView, levelData, onLogout }) {
  const navItems = [
    { id: 'home', label: 'Dashboard', icon: Home },
    { id: 'more', label: 'Subject Odysseys', icon: BookOpen },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className="hidden md:flex w-72 bg-espresso-900 text-parchment-50 flex-col h-screen fixed left-0 top-0 border-r border-[#3a281c] shadow-2xl z-20">
      <div className="p-8 pb-6 flex items-center gap-3">
        <Sparkles className="text-gold-400" size={28} />
        <h1 className="text-2xl font-serif font-bold tracking-wide text-transparent bg-clip-text bg-gradient-to-r from-gold-400 to-gold-300">
          PROGRESS
        </h1>
      </div>

      <div className="px-6 mb-10">
        <div className="bg-[#362419] rounded-2xl p-4 flex items-center gap-4 border border-[#4a3423] shadow-inner">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-gold-500 to-gold-600 flex items-center justify-center text-espresso-950 shadow-lg shadow-gold-500/20">
            <Swords size={24} />
          </div>
          <div>
            <h3 className="font-serif font-bold text-white leading-tight">Anonymous</h3>
            <p className="text-gold-400 text-xs font-semibold tracking-wider uppercase mt-1">Level {romanize(levelData.level)} Hero</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-4 space-y-2 relative">
        {navItems.map(item => {
          const Icon = item.icon;
          const isActive = currentView === item.id || (item.id === 'more' && currentView === 'topic');
          return (
            <button
              key={item.id}
              onClick={() => setCurrentView(item.id)}
              className={`w-full flex items-center gap-4 px-4 py-3.5 rounded-xl transition-all duration-300 font-medium ${isActive
                  ? 'bg-[#362419] text-gold-400 shadow-md border border-[#4a3423]'
                  : 'text-espresso-200 hover:bg-[#2b1b12] hover:text-white'
                }`}
            >
              <Icon size={20} className={isActive ? "text-gold-400" : "opacity-70"} />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="p-6 mt-auto">
        <div className="bg-[#362419] rounded-2xl p-4 border border-[#4a3423] text-center">
          <Target className="mx-auto text-gold-400 mb-2" size={24} />
          <h4 className="font-semibold text-sm text-white mb-1">Daily Challenge</h4>
          <p className="text-xs text-espresso-300">Complete all quests today</p>
        </div>
      </div>
    </div>
  );
}

function Header({ xp, levelData }) {
  return (
    <header className="md:ml-72 bg-parchment-50 sticky top-0 z-10 px-4 md:px-8 py-6 border-b border-espresso-200/40 backdrop-blur-xl bg-opacity-80">
      <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-4">

        <div className="md:hidden flex items-center gap-3">
          <Sparkles className="text-gold-500" size={24} />
          <h1 className="text-xl font-serif font-bold tracking-wide">PROGRESS</h1>
        </div>

        <div className="w-full md:w-[28rem] bg-white rounded-2xl p-4 border border-espresso-100 shadow-sm">
          <div className="flex justify-between items-end mb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl border-2 border-gold-400 flex items-center justify-center font-serif font-bold text-espresso-900 bg-gold-400/10">
                {levelData.level}
              </div>
              <div>
                <h3 className="font-serif font-bold text-espresso-900 text-lg leading-tight">Hero Level {romanize(levelData.level)}</h3>
                <p className="text-xs text-espresso-500 font-medium mt-0.5">{levelData.nextLevelXp - levelData.currentLevelXp} XP to Level {romanize(levelData.level + 1)}</p>
              </div>
            </div>
            <div className="text-sm font-semibold text-espresso-800">
              {levelData.currentLevelXp.toLocaleString()} <span className="text-espresso-400 font-normal">/ {levelData.nextLevelXp.toLocaleString()} XP</span>
            </div>
          </div>
          <div className="h-2.5 bg-espresso-100 rounded-full overflow-hidden w-full relative">
            <div
              className="absolute top-0 left-0 h-full bg-gradient-to-r from-gold-500 to-gold-400 rounded-full transition-all duration-1000 ease-out"
              style={{ width: `${levelData.progressPercent}%` }}
            />
          </div>
        </div>
      </div>
    </header>
  );
}

function HomeView({ tasks, toggleTaskCompletion, addTask, xp }) {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });

  const weekDays = Array.from({ length: 7 }).map((_, i) => addDays(weekStart, i));

  const formattedSelectedDate = format(selectedDate, 'yyyy-MM-dd');
  const dayTasks = tasks.filter(t => t.date === formattedSelectedDate);
  const completedCount = dayTasks.filter(t => t.completed).length;

  const handleAddTask = (e) => {
    e.preventDefault();
    if (newTaskTitle.trim()) {
      addTask(newTaskTitle.trim(), formattedSelectedDate);
      setNewTaskTitle("");
    }
  };

  const level = Math.floor(xp / XP_PER_LEVEL) + 1;
  const questsCompleted = tasks.filter(t => t.completed).length;

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-fade-in md:ml-72">
      {/* Welcome Banner */}
      <div className="bg-gradient-to-br from-white to-parchment-100 rounded-3xl p-8 border border-espresso-100 shadow-sm relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 text-espresso-100/50 pointer-events-none transform scale-150 translate-x-10 -translate-y-10">
          <BookOpen strokeWidth={1} size={250} />
        </div>

        <p className="text-xs font-bold tracking-widest text-espresso-400 uppercase mb-2 flex items-center gap-2">
          Good Evening, Hero <Sparkles size={14} className="text-gold-500" />
        </p>
        <h2 className="text-4xl md:text-5xl font-serif font-bold text-espresso-900 mb-4 tracking-tight">
          Forge Your Destiny
        </h2>
        <p className="text-espresso-600 max-w-xl text-lg leading-relaxed mb-10">
          Every great odyssey begins with a single step. Complete your daily quests to rise through the ranks of knowledge.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard icon={<Flame className="text-orange-500" />} label="Day Streak" value="1" />
          <StatCard icon={<Swords className="text-gold-500" />} label="Quests Done" value={questsCompleted.toString()} />
          <StatCard icon={<Trophy className="text-yellow-500" />} label="XP Earned" value={xp.toLocaleString()} />
          <StatCard icon={<Target className="text-indigo-500" />} label="Level" value={romanize(level) || "I"} />
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-8">
        <div className="flex-1 space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-2xl font-serif font-bold flex items-center gap-3">
              <Calendar className="text-gold-500" /> Daily Quests
            </h3>
            <span className="text-sm font-semibold text-espresso-500 bg-white px-4 py-1.5 rounded-full border border-espresso-100">
              <span className="text-espresso-900">{completedCount}</span> / {dayTasks.length} completed
            </span>
          </div>

          {/* Calendar Strip */}
          <div className="bg-white rounded-2xl p-2 flex justify-between shadow-sm border border-espresso-100 overflow-x-auto hide-scrollbar">
            {weekDays.map(day => {
              const isSelected = isSameDay(day, selectedDate);
              const isToday = isSameDay(day, new Date());
              return (
                <button
                  key={day.toString()}
                  onClick={() => setSelectedDate(day)}
                  className={`flex flex-col items-center justify-center p-3 md:p-4 min-w-[3.5rem] md:min-w-[4.5rem] rounded-xl transition-all ${isSelected
                      ? 'bg-espresso-900 text-gold-400 shadow-md transform scale-105'
                      : 'hover:bg-parchment-100 text-espresso-600'
                    }`}
                >
                  <span className={`text-[10px] md:text-xs font-bold uppercase tracking-wider mb-1.5 ${isSelected ? 'text-espresso-200' : 'text-espresso-400'}`}>
                    {format(day, 'EEE')}
                  </span>
                  <span className={`text-lg md:text-xl font-serif font-bold ${isToday && !isSelected ? 'text-gold-600' : ''}`}>
                    {format(day, 'd')}
                  </span>
                  {isToday && <div className={`w-1 h-1 rounded-full mt-1.5 ${isSelected ? 'bg-gold-400' : 'bg-gold-500'}`} />}
                </button>
              );
            })}
          </div>

          {/* Progress Bar for the day */}
          {dayTasks.length > 0 && (
            <div className="bg-white p-6 rounded-2xl border border-espresso-100 shadow-sm">
              <div className="flex justify-between items-center mb-3">
                <span className="text-xs font-bold tracking-widest text-espresso-500 uppercase">Quest Progress</span>
                <span className="text-lg font-bold text-espresso-900">{Math.round((completedCount / dayTasks.length) * 100)}%</span>
              </div>
              <div className="h-3 bg-espresso-50 rounded-full overflow-hidden relative border border-espresso-100">
                <div
                  className="absolute top-0 left-0 h-full bg-gold-500 transition-all duration-500 ease-out"
                  style={{ width: `${(completedCount / dayTasks.length) * 100}%` }}
                />
              </div>
            </div>
          )}

          {/* Task List */}
          <div className="space-y-3">
            {dayTasks.map(task => (
              <div
                key={task.id}
                className={`group flex items-center gap-4 p-5 rounded-2xl border transition-all duration-300 relative overflow-hidden
                  ${task.completed
                    ? 'bg-parchment-100/50 border-espresso-200/50 opacity-70'
                    : 'bg-white border-espresso-200 hover:border-gold-400/50 shadow-sm hover:shadow-md'
                  }`}
              >
                <button
                  onClick={() => toggleTaskCompletion(task.id, task.completed)}
                  className={`flex-shrink-0 w-7 h-7 rounded-lg border-2 flex items-center justify-center transition-all ${task.completed
                      ? 'bg-gold-500 border-gold-500 text-white'
                      : 'border-espresso-300 text-transparent hover:border-gold-400'
                    }`}
                >
                  <Check size={16} strokeWidth={3} />
                </button>
                <div className={`flex-1 transition-all ${task.completed ? 'line-through text-espresso-400' : 'text-espresso-900 font-medium text-lg'}`}>
                  {task.title}
                </div>
                {task.completed && (
                  <div className="text-xs font-bold text-gold-600 bg-gold-100 px-3 py-1 rounded-full animate-fade-in">+30 XP</div>
                )}
              </div>
            ))}

            <form onSubmit={handleAddTask} className="flex gap-3 pt-4">
              <input
                type="text"
                placeholder="Commit to a new quest for today..."
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                className="flex-1 bg-white border border-espresso-200 rounded-xl px-5 py-4 focus:outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500 transition-all text-espresso-900 placeholder:text-espresso-300 shadow-sm"
              />
              <button
                type="submit"
                disabled={!newTaskTitle.trim()}
                className="bg-espresso-900 text-white px-6 rounded-xl font-medium hover:bg-espresso-800 disabled:opacity-50 transition-colors flex items-center shadow-sm"
              >
                <Plus size={24} />
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }) {
  return (
    <div className="bg-white/80 backdrop-blur-md p-5 rounded-2xl border border-white shadow-sm flex flex-col justify-center">
      <div className="flex items-center gap-3 mb-2">
        <div className="p-2 bg-espresso-50 rounded-xl">{icon}</div>
        <div className="text-2xl font-bold font-serif text-espresso-900">{value}</div>
      </div>
      <div className="text-xs font-semibold text-espresso-500 uppercase tracking-wider">{label}</div>
    </div>
  );
}

function MoreView({ topics, addTopic, onViewTopic }) {
  const [newTopic, setNewTopic] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (newTopic.trim()) {
      addTopic(newTopic.trim());
      setNewTopic("");
      setIsAdding(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-fade-in md:ml-72">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-4xl font-serif font-bold text-espresso-900 mb-2">Subject Odysseys</h2>
          <p className="text-espresso-500">Master new realms of knowledge</p>
        </div>
        <button
          onClick={() => setIsAdding(!isAdding)}
          className="flex items-center gap-2 bg-espresso-900 text-white px-5 py-3 rounded-xl font-medium hover:bg-espresso-800 transition-colors shadow-sm"
        >
          <Plus size={20} /> <span className="hidden sm:inline">New Odyssey</span>
        </button>
      </div>

      {isAdding && (
        <form onSubmit={handleSubmit} className="bg-white p-6 rounded-2xl border border-espresso-200 shadow-sm animate-fade-in">
          <label className="block text-sm font-bold text-espresso-700 mb-2 uppercase tracking-wide">Determine your new subject</label>
          <div className="flex gap-3">
            <input
              autoFocus
              value={newTopic}
              onChange={(e) => setNewTopic(e.target.value)}
              placeholder="e.g., Machine Learning, Latin, Ancient History..."
              className="flex-1 border border-espresso-200 rounded-xl px-4 py-3 focus:outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500 bg-parchment-50"
            />
            <button type="submit" className="bg-gold-500 text-white px-6 py-3 rounded-xl font-bold hover:bg-gold-400 transition-colors">
              Embark
            </button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {topics.map(topic => (
          <button
            key={topic.id}
            onClick={() => onViewTopic(topic)}
            className="group bg-white p-6 rounded-2xl border border-espresso-100 shadow-sm hover:shadow-lg hover:border-gold-400/50 transition-all text-left flex flex-col h-48 relative overflow-hidden"
          >
            <div className="absolute -right-6 -top-6 w-32 h-32 bg-gold-50 rounded-full opacity-50 group-hover:scale-150 transition-transform duration-500 ease-out" />
            <div className="absolute right-4 top-4 text-gold-400 opacity-20 group-hover:opacity-100 transition-opacity">
              <BookOpen size={48} strokeWidth={1} />
            </div>

            <div className="text-xs font-bold tracking-widest text-espresso-400 uppercase mb-auto">Realm of Study</div>
            <h3 className="text-2xl font-serif font-bold text-espresso-900 mb-2 relative z-10 group-hover:text-gold-600 transition-colors">
              {topic.title}
            </h3>
            <div className="text-sm font-medium text-espresso-500 flex items-center gap-2 relative z-10">
              Enter Library <ChevronLeft className="rotate-180" size={16} />
            </div>
          </button>
        ))}

        {topics.length === 0 && !isAdding && (
          <div className="col-span-full py-16 text-center border-2 border-dashed border-espresso-200 rounded-3xl bg-white/50">
            <BookOpen size={48} className="mx-auto text-espresso-300 mb-4" />
            <h3 className="text-xl font-serif font-bold text-espresso-700 mb-2">No active Odysseys</h3>
            <p className="text-espresso-500">Click 'New Odyssey' to begin learning a new subject.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function TopicDetailsView({ topic, onBack, geminiKey }) {
  const [messages, setMessages] = useState([
    { role: 'model', text: `Greetings, seeker of knowledge. I am your mentor for **${topic.title}**. What shall we explore today?` }
  ]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim() || !geminiKey) return;

    const userMsg = input.trim();
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setInput("");
    setIsTyping(true);

    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: `You are an expert, eloquent tutor helping the user learn ${topic.title}. Use a slightly formal, encouraging tone similar to a wise mentor from Greek mythology or a stoic philosopher, but keep pedagogy highly effective and modern. Format output with markdown.` }]
          },
          contents: [...messages, { role: 'user', text: userMsg }].map(m => ({
            role: m.role === 'model' ? 'model' : 'user',
            parts: [{ text: m.text }]
          }))
        })
      });

      const data = await response.json();
      if (data.candidates && data.candidates[0]) {
        const text = data.candidates[0].content.parts[0].text;
        setMessages(prev => [...prev, { role: 'model', text }]);
      } else {
        throw new Error("Invalid response format");
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'model', text: `*The oracle is silent.* (Error connecting to AI: ${err.message})` }]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto h-[calc(100vh-8rem)] flex flex-col animate-fade-in md:ml-72 bg-white rounded-3xl border border-espresso-100 shadow-xl overflow-hidden">
      {/* Header */}
      <div className="bg-espresso-900 px-6 py-4 flex items-center justify-between shadow-md relative z-10">
        <button onClick={onBack} className="text-espresso-300 hover:text-white transition-colors flex items-center gap-2 font-medium">
          <ChevronLeft size={20} /> Back to Odysseys
        </button>
        <h2 className="text-xl font-serif font-bold text-gold-400 capitalize">{topic.title} Library</h2>
        <div className="w-8" /> {/* spacer */}
      </div>

      {/* Chat Area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-6 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] bg-parchment-50">
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] md:max-w-[75%] rounded-2xl p-5 shadow-sm ${msg.role === 'user'
                ? 'bg-espresso-900 text-white rounded-br-none'
                : 'bg-white border border-espresso-200 text-espresso-900 rounded-tl-none font-serif leading-relaxed'
              }`}>
              {msg.role === 'model' && <Sparkles size={16} className="text-gold-500 mb-2 inline-block mr-2" />}
              <div
                className="prose prose-sm md:prose-base max-w-none prose-p:my-1 prose-headings:font-serif prose-headings:text-espresso-900 prose-strong:text-espresso-950 prose-a:text-gold-600 prose-ul:my-2 prose-li:my-0 pb-1"
                dangerouslySetInnerHTML={{ __html: msg.text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br/>') }}
              />
            </div>
          </div>
        ))}
        {isTyping && (
          <div className="flex justify-start">
            <div className="bg-white border border-espresso-200 text-espresso-400 rounded-2xl rounded-tl-none p-5 flex items-center gap-2 shadow-sm">
              <Sparkles size={16} className="animate-pulse text-gold-500" /> Consultating the Oracle...
            </div>
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="p-4 bg-white border-t border-espresso-100">
        <form onSubmit={handleSend} className="relative flex items-center max-w-3xl mx-auto">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask your mentor a question..."
            className="w-full bg-parchment-100 border border-espresso-200 rounded-xl pl-5 pr-14 py-4 focus:outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500 font-medium text-espresso-900"
          />
          <button
            type="submit"
            disabled={!input.trim() || isTyping}
            className="absolute right-2 bg-gold-500 text-white p-2.5 rounded-lg hover:bg-gold-400 disabled:opacity-50 transition-colors shadow-sm"
          >
            <Send size={20} />
          </button>
        </form>
      </div>
    </div>
  );
}
