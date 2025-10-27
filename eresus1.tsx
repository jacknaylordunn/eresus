import React, { useState, useEffect, useRef, createContext, useContext, useMemo } from 'react';
import { initializeApp, FirebaseApp } from 'firebase/app';
import { 
  getFirestore, 
  Firestore, 
  doc, 
  collection, 
  addDoc, 
  setDoc, 
  deleteDoc, 
  query, 
  onSnapshot,
  Timestamp,
  getDocs,
  where
} from 'firebase/firestore';
import { 
  getAuth, 
  Auth, 
  signInAnonymously, 
  signInWithCustomToken, 
  onAuthStateChanged,
  User
} from 'firebase/auth';
import { 
  Heart, 
  Book, // Replaced BookClosed
  Settings, 
  RotateCw, // Replaced ArrowClockwise
  Undo, 
  Clipboard, 
  Activity, // Replaced WavePulse
  Zap, 
  Syringe, 
  Pill, 
  AirVent, // Replaced Lungs
  Gauge, 
  HeartPulse, 
  XSquare, 
  ChevronRight, 
  Circle, 
  CheckCircle2, 
  Bolt, 
  Timer, 
  Volume2, 
  VolumeX, 
  AlertTriangle,
  FileText,
  Plus,
  Minus,
  Moon,
  Sun,
  Laptop
} from 'lucide-react';

//============================================================================
// GLOBAL FIREBASE CONFIG & APP ID
// These are expected to be injected by the environment.
//============================================================================
declare global {
  var __firebase_config: string;
  var __initial_auth_token: string;
  var __app_id: string;
}

const firebaseConfig = JSON.parse(typeof __firebase_config !== 'undefined' ? __firebase_config : '{}');
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-eresus-app-id';
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

//============================================================================
// TYPE DEFINITIONS (from Models.swift & types.ts)
//============================================================================

// Database Models
export interface SavedArrestLog {
  id?: string;
  startTime: Timestamp; // Use Firestore Timestamp
  totalDuration: number;
  finalOutcome: string;
  userId: string;
  // Events will be a subcollection
}

export interface Event {
  id?: string;
  timestamp: number;
  message: string;
  type: EventType;
}

// App State Enums
export enum ArrestState {
  Pending = "PENDING",
  Active = "ACTIVE",
  Rosc = "ROSC",
  Ended = "DECEASED",
}

export enum EventType {
  Status = "status",
  Cpr = "cpr",
  Shock = "shock",
  Analysis = "analysis",
  Rhythm = "rhythm",
  Drug = "drug",
  Airway = "airway",
  Etco2 = "etco2",
  Cause = "cause",
}

export enum UIState {
  Default = "default",
  Analyzing = "analyzing",
  ShockAdvised = "shockAdvised",
}

export enum AntiarrhythmicDrug {
  None = "none",
  Amiodarone = "amiodarone",
  Lidocaine = "lidocaine",
}

export enum HypothermiaStatus {
  None = "none",
  Severe = "severe",
  Moderate = "moderate",
  Normothermic = "normothermic",
}

export enum AppearanceMode {
  System = "System",
  Light = "Light",
  Dark = "Dark",
}

export type DrugToLog = 
  | { type: 'adrenaline' }
  | { type: 'amiodarone' }
  | { type: 'lidocaine' }
  | { type: 'other'; name: string };

export const getDrugLogTitle = (drug: DrugToLog): string => {
  switch (drug.type) {
    case 'adrenaline': return 'Adrenaline';
    case 'amiodarone': return 'Amiodarone';
    case 'lidocaine': return 'Lidocaine';
    case 'other': return drug.name;
  }
};

// UI & Data Structs
export interface ChecklistItem {
  id: string;
  name: string;
  isCompleted: boolean;
  hypothermiaStatus: HypothermiaStatus;
}

export interface UndoState {
  arrestState: ArrestState;
  masterTime: number;
  cprTime: number;
  timeOffset: number;
  events: Event[]; // Store events directly
  shockCount: number;
  adrenalineCount: number;
  amiodaroneCount: number;
  lidocaineCount: number;
  lastAdrenalineTime: number | null;
  antiarrhythmicGiven: AntiarrhythmicDrug;
  shockCountForAmiodarone1: number | null;
  airwayPlaced: boolean;
  reversibleCauses: ChecklistItem[];
  postROSCTasks: ChecklistItem[];
  postMortemTasks: ChecklistItem[];
  startTime: Date | null;
  uiState: UIState;
  patientAgeCategory: PatientAgeCategory | null;
}

export interface PDFIdentifiable {
  id: string;
  pdfUrl: string; // Use URL directly
  title: string;
}

//============================================================================
// APP CONSTANTS & SETTINGS (from Models.swift)
//============================================================================

// AppSettings replacement using localStorage for simple settings
const useAppStorage = <T,>(key: string, defaultValue: T): [T, (value: T) => void] => {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : defaultValue;
    } catch (error) {
      console.error(error);
      return defaultValue;
    }
  });

  const setValue = (value: T) => {
    try {
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
      window.localStorage.setItem(key, JSON.stringify(valueToStore));
    } catch (error) {
      console.error(error);
    }
  };

  return [storedValue, setValue];
};

// Global settings hook
const useAppSettings = () => {
  const [cprCycleDuration, setCprCycleDuration] = useAppStorage('cprCycleDuration', 120);
  const [adrenalineInterval, setAdrenalineInterval] = useAppStorage('adrenalineInterval', 240);
  const [metronomeBPM, setMetronomeBPM] = useAppStorage('metronomeBPM', 110);
  const [appearanceMode, setAppearanceMode] = useAppStorage<AppearanceMode>('appearanceMode', AppearanceMode.System);
  const [showDosagePrompts, setShowDosagePrompts] = useAppStorage('showDosagePrompts', false);

  return {
    cprCycleDuration, setCprCycleDuration,
    adrenalineInterval, setAdrenalineInterval,
    metronomeBPM, setMetronomeBPM,
    appearanceMode, setAppearanceMode,
    showDosagePrompts, setShowDosagePrompts,
  };
};
type AppSettingsContextType = ReturnType<typeof useAppSettings>;
const AppSettingsContext = createContext<AppSettingsContextType | null>(null);
const useSettings = () => useContext(AppSettingsContext)!;

// AppConstants
const AppConstants = {
  reversibleCausesTemplate: (): ChecklistItem[] => [
    { id: 'hypoxia', name: "Hypoxia", isCompleted: false, hypothermiaStatus: HypothermiaStatus.None },
    { id: 'hypovolemia', name: "Hypovolemia", isCompleted: false, hypothermiaStatus: HypothermiaStatus.None },
    { id: 'hypo-hyperkalaemia', name: "Hypo/Hyperkalaemia", isCompleted: false, hypothermiaStatus: HypothermiaStatus.None },
    { id: 'hypothermia', name: "Hypothermia", isCompleted: false, hypothermiaStatus: HypothermiaStatus.None },
    { id: 'toxins', name: "Toxins", isCompleted: false, hypothermiaStatus: HypothermiaStatus.None },
    { id: 'tamponade', name: "Tamponade", isCompleted: false, hypothermiaStatus: HypothermiaStatus.None },
    { id: 'tension-pneumothorax', name: "Tension Pneumothorax", isCompleted: false, hypothermiaStatus: HypothermiaStatus.None },
    { id: 'thrombosis', name: "Thrombosis", isCompleted: false, hypothermiaStatus: HypothermiaStatus.None }
  ],
  
  postROSCTasksTemplate: (): ChecklistItem[] => [
    { id: 'ventilation', name: "Optimise Ventilation & Oxygenation", isCompleted: false, hypothermiaStatus: HypothermiaStatus.None },
    { id: 'ecg', name: "12-Lead ECG", isCompleted: false, hypothermiaStatus: HypothermiaStatus.None },
    { id: 'hypotension', name: "Treat Hypotension (SBP < 90)", isCompleted: false, hypothermiaStatus: HypothermiaStatus.None },
    { id: 'glucose', name: "Check Blood Glucose", isCompleted: false, hypothermiaStatus: HypothermiaStatus.None },
    { id: 'temp', name: "Consider Temperature Control", isCompleted: false, hypothermiaStatus: HypothermiaStatus.None },
    { id: 'causes', name: "Identify & Treat Causes", isCompleted: false, hypothermiaStatus: HypothermiaStatus.None }
  ],
  
  postMortemTasksTemplate: (): ChecklistItem[] => [
    { id: 'reposition', name: "Reposition body & remove lines/tubes", isCompleted: false, hypothermiaStatus: HypothermiaStatus.None },
    { id: 'docs', name: "Complete documentation", isCompleted: false, hypothermiaStatus: HypothermiaStatus.None },
    { id: 'determine', name: "Determine expected/unexpected death", isCompleted: false, hypothermiaStatus: HypothermiaStatus.None },
    { id: 'coroner', name: "Contact Coroner (if unexpected)", isCompleted: false, hypothermiaStatus: HypothermiaStatus.None },
    { id: 'handling', name: "Follow local body handling procedure", isCompleted: false, hypothermiaStatus: HypothermiaStatus.None },
    { id: 'leaflet', name: "Provide leaflet to bereaved relatives", isCompleted: false, hypothermiaStatus: HypothermiaStatus.None },
    { id: 'donation', name: "Consider organ/tissue donation", isCompleted: false, hypothermiaStatus: HypothermiaStatus.None }
  ],
  
  otherDrugs: [
    "Adenosine", "Adrenaline 1:1000", "Adrenaline 1:10,000", "Amiodarone (Further Dose)",
    "Atropine", "Calcium chloride", "Glucose", "Hartmann’s solution", "Magnesium sulphate",
    "Midazolam", "Naloxone", "Potassium chloride", "Sodium bicarbonate", "Sodium chloride", "Tranexamic acid"
  ].sort(),

  pdfAlgorithms: [
    { id: 'adult', pdfUrl: "https://www.resus.org.uk/sites/default/files/2024-01/Adult%20Advanced%20Life%20Support%20Algorithm%202021%20Aug%202023.pdf", title: "Adult ALS" },
    { id: 'paeds', pdfUrl: "https://www.resus.org.uk/sites/default/files/2021-04/Paediatric%20ALS%20Algorithm%202021.pdf", title: "Paediatric ALS" },
    { id: 'newborn', pdfUrl: "https://www.resus.org.uk/sites/default/files/2021-05/Newborn%20Life%20Support%20Algorithm%202021.pdf", title: "Newborn LS" },
    { id: 'post', pdfUrl: "https://www.resus.org.uk/sites/default/files/2023-08/Post%20cardiac%20arrest%20rehabilitation%20algorithim%202023.pdf", title: "Post Arrest Care" }
  ]
};

//============================================================================
// APP SERVICES (from AppServices.swift)
//============================================================================

// --- TimeFormatter ---
const TimeFormatter = {
  format: (timeInterval: number): string => {
    const time = Math.max(0, timeInterval);
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
};

// --- HapticManager ---
const HapticManager = {
  impact: (style: 'light' | 'medium' | 'heavy' = 'light') => {
    if (window.navigator.vibrate) {
      let duration = 10;
      if (style === 'medium') duration = 20;
      if (style === 'heavy') duration = 30;
      window.navigator.vibrate(duration);
    }
  },
  notification: (type: 'success' | 'warning' | 'error') => {
    if (window.navigator.vibrate) {
      if (type === 'success') window.navigator.vibrate([10, 50, 10]);
      if (type === 'warning') window.navigator.vibrate([20, 50, 20]);
      if (type === 'error') window.navigator.vibrate([30, 50, 30, 50, 30]);
    }
  }
};

// --- Metronome ---
class MetronomeService {
  private audioContext: AudioContext | null = null;
  private timer: NodeJS.Timeout | null = null;
  private _isPlaying = false;
  private bpm = 110;

  private getAudioContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return this.audioContext;
  }

  private playSound() {
    try {
      const context = this.getAudioContext();
      if (context.state === 'suspended') {
        context.resume();
      }
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, context.currentTime);
      gain.gain.setValueAtTime(1, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.05);
      
      oscillator.connect(gain);
      gain.connect(context.destination);
      
      oscillator.start(context.currentTime);
      oscillator.stop(context.currentTime + 0.05);
    } catch (e) {
      console.error("Error playing metronome sound:", e);
    }
  }

  public toggle(bpm: number) {
    this.bpm = bpm;
    if (this._isPlaying) {
      this.stop();
    } else {
      this.start();
    }
    return this._isPlaying;
  }

  public start() {
    if (this._isPlaying) return;
    const interval = 60000 / this.bpm;
    this._isPlaying = true;
    this.playSound(); // Play immediately
    this.timer = setInterval(() => this.playSound(), interval);
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this._isPlaying = false;
  }
  
  public get isPlaying() {
    return this._isPlaying;
  }
}
// Use a singleton instance
const metronomeService = new MetronomeService();

//============================================================================
// DOSAGE CALCULATOR (from DosageCalculator.swift)
//============================================================================

export enum PatientAgeCategory {
  Adult = "≥12 years / Adult",
  ElevenYears = "11 years",
  TenYears = "10 years",
  NineYears = "9 years",
  EightYears = "8 years",
  SevenYears = "7 years",
  SixYears = "6 years",
  FiveYears = "5 years",
  FourYears = "4 years",
  ThreeYears = "3 years",
  TwoYears = "2 years",
  EighteenMonths = "18 months",
  TwelveMonths = "12 months",
  NineMonths = "9 months",
  SixMonths = "6 months",
  ThreeMonths = "3 months",
  OneMonth = "1 month",
  PostBirthToOneMonth = "Post-birth to 1 month",
  AtBirth = "At birth",
}
export const allPatientAgeCategories = Object.values(PatientAgeCategory);

const DosageCalculator = {
  calculateAdrenalineDose: (age: PatientAgeCategory): string => {
    switch (age) {
      case PatientAgeCategory.Adult: return "1mg";
      case PatientAgeCategory.ElevenYears: return "350mcg";
      case PatientAgeCategory.TenYears: return "320mcg";
      case PatientAgeCategory.NineYears: return "300mcg";
      case PatientAgeCategory.EightYears: return "260mcg";
      case PatientAgeCategory.SevenYears: return "230mcg";
      case PatientAgeCategory.SixYears: return "210mcg";
      case PatientAgeCategory.FiveYears: return "190mcg";
      case PatientAgeCategory.FourYears: return "160mcg";
      case PatientAgeCategory.ThreeYears: return "140mcg";
      case PatientAgeCategory.TwoYears: return "120mcg";
      case PatientAgeCategory.EighteenMonths: return "110mcg";
      case PatientAgeCategory.TwelveMonths: return "100mcg";
      case PatientAgeCategory.NineMonths: return "90mcg";
      case PatientAgeCategory.SixMonths: return "80mcg";
      case PatientAgeCategory.ThreeMonths: return "60mcg";
      case PatientAgeCategory.OneMonth: return "50mcg";
      case PatientAgeCategory.PostBirthToOneMonth: return "50mcg";
      case PatientAgeCategory.AtBirth: return "70mcg";
      default: return "N/A";
    }
  },

  calculateAmiodaroneDose: (age: PatientAgeCategory, doseNumber: number): string | null => {
    // doseNumber 1 is initial dose, 2 is repeat dose
    switch (age) {
      case PatientAgeCategory.Adult:
        return doseNumber === 1 ? "300mg" : "150mg";
      case PatientAgeCategory.ElevenYears:
        return doseNumber === 1 ? "180mg" : "180mg";
      case PatientAgeCategory.TenYears:
        return doseNumber === 1 ? "160mg" : "160mg";
      case PatientAgeCategory.NineYears:
        return doseNumber === 1 ? "150mg" : "150mg";
      case PatientAgeCategory.EightYears:
        return doseNumber === 1 ? "130mg" : "130mg";
      case PatientAgeCategory.SevenYears:
        return doseNumber === 1 ? "120mg" : "120mg";
      case PatientAgeCategory.SixYears:
        return doseNumber === 1 ? "100mg" : "100mg";
      case PatientAgeCategory.FiveYears:
        return doseNumber === 1 ? "100mg" : "100mg";
      case PatientAgeCategory.FourYears:
        return doseNumber === 1 ? "80mg" : "80mg";
      case PatientAgeCategory.ThreeYears:
        return doseNumber === 1 ? "70mg" : "60mg";
      case PatientAgeCategory.TwoYears:
        return doseNumber === 1 ? "60mg" : "60mg";
      case PatientAgeCategory.EighteenMonths:
        return doseNumber === 1 ? "55mg" : "55mg";
      case PatientAgeCategory.TwelveMonths:
        return doseNumber === 1 ? "50mg" : "50mg";
      case PatientAgeCategory.NineMonths:
        return doseNumber === 1 ? "45mg" : "45mg";
      case PatientAgeCategory.SixMonths:
        return doseNumber === 1 ? "40mg" : "40mg";
      case PatientAgeCategory.ThreeMonths:
        return doseNumber === 1 ? "30mg" : "30mg";
      case PatientAgeCategory.OneMonth:
        return doseNumber === 1 ? "25mg" : "25mg";
      case PatientAgeCategory.PostBirthToOneMonth:
      case PatientAgeCategory.AtBirth:
        return null; // N/A
      default: return null;
    }
  }
};

//============================================================================
// FIREBASE CONTEXT
//============================================================================
interface FirebaseContextType {
  app: FirebaseApp;
  db: Firestore;
  auth: Auth;
  user: User | null;
  userId: string;
}
const FirebaseContext = createContext<FirebaseContextType | null>(null);
const useFirebase = () => useContext(FirebaseContext)!;

const FirebaseProvider: React.FC<React.PropsWithChildren<{}>> = ({ children }) => {
  const [services, setServices] = useState<FirebaseContextType | null>(null);

  useEffect(() => {
    try {
      const app = initializeApp(firebaseConfig);
      const db = getFirestore(app);
      const auth = getAuth(app);

      onAuthStateChanged(auth, async (user) => {
        let authedUser = user;
        if (!authedUser) {
          try {
            if (initialAuthToken) {
              const userCredential = await signInWithCustomToken(auth, initialAuthToken);
              authedUser = userCredential.user;
            } else {
              const userCredential = await signInAnonymously(auth);
              authedUser = userCredential.user;
            }
          } catch (authError) {
            console.error("Firebase auth error:", authError);
            // Fallback to anonymous sign-in if custom token fails
            if (!auth.currentUser) {
                const userCredential = await signInAnonymously(auth);
                authedUser = userCredential.user;
            }
          }
        }
        
        const userId = authedUser?.uid || crypto.randomUUID();
        
        setServices({
          app,
          db,
          auth,
          user: authedUser,
          userId: userId,
        });
      });
    } catch (e) {
      console.error("Failed to initialize Firebase", e);
    }
  }, []);

  if (!services) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-100 dark:bg-gray-900">
        <div className="flex flex-col items-center">
          <HeartPulse className="w-16 h-16 text-red-500 animate-pulse" />
          <p className="text-lg text-gray-700 dark:text-gray-300 mt-4">Connecting to services...</p>
        </div>
      </div>
    );
  }

  return (
    <FirebaseContext.Provider value={services}>
      {children}
    </FirebaseContext.Provider>
  );
};


//============================================================================
// CORE LOGIC: ArrestViewModel -> useArrestViewModel (React Hook)
//============================================================================

const useArrestViewModel = () => {
  const { db, userId } = useFirebase();
  const { cprCycleDuration, adrenalineInterval, showDosagePrompts } = useSettings();

  // --- Published State Properties ---
  const [arrestState, setArrestState] = useState<ArrestState>(ArrestState.Pending);
  const [masterTime, setMasterTime] = useState<number>(0);
  const [cprTime, setCprTime] = useState<number>(cprCycleDuration);
  const [timeOffset, setTimeOffset] = useState<number>(0);
  const [uiState, setUiState] = useState<UIState>(UIState.Default);
  const [events, setEvents] = useState<Event[]>([]);

  const [shockCount, setShockCount] = useState(0);
  const [adrenalineCount, setAdrenalineCount] = useState(0);
  const [amiodaroneCount, setAmiodaroneCount] = useState(0);
  const [lidocaineCount, setLidocaineCount] = useState(0);

  const [airwayPlaced, setAirwayPlaced] = useState(false);
  const [antiarrhythmicGiven, setAntiarrhythmicGiven] = useState<AntiarrhythmicDrug>(AntiarrhythmicDrug.None);

  const [reversibleCauses, setReversibleCauses] = useState<ChecklistItem[]>(AppConstants.reversibleCausesTemplate());
  const [postROSCTasks, setPostROSCTasks] = useState<ChecklistItem[]>(AppConstants.postROSCTasksTemplate());
  const [postMortemTasks, setPostMortemTasks] = useState<ChecklistItem[]>(AppConstants.postMortemTasksTemplate());
  const [patientAgeCategory, setPatientAgeCategory] = useState<PatientAgeCategory | null>(null);

  // --- Private State Properties ---
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<Date | null>(null);
  const cprCycleStartTimeRef = useRef<number>(0);
  const lastAdrenalineTimeRef = useRef<number | null>(null);
  const shockCountForAmiodarone1Ref = useRef<number | null>(null);
  const [undoHistory, setUndoHistory] = useState<UndoState[]>([]);

  // --- Computed Properties ---
  const totalArrestTime = useMemo(() => masterTime + timeOffset, [masterTime, timeOffset]);
  const canUndo = undoHistory.length > 0;

  const isAdrenalineAvailable = useMemo(() => {
    return reversibleCauses.find(item => item.name === "Hypothermia")?.hypothermiaStatus !== HypothermiaStatus.Severe;
  }, [reversibleCauses]);

  const isAmiodaroneAvailable = useMemo(() => {
    const isEligibleShockCount = (shockCount >= 3 && amiodaroneCount === 0) || (shockCount >= 5 && amiodaroneCount === 1);
    return isEligibleShockCount && antiarrhythmicGiven !== AntiarrhythmicDrug.Lidocaine && isAdrenalineAvailable;
  }, [shockCount, amiodaroneCount, antiarrhythmicGiven, isAdrenalineAvailable]);

  const isLidocaineAvailable = useMemo(() => {
    const isEligibleShockCount = (shockCount >= 3 && lidocaineCount === 0) || (shockCount >= 5 && lidocaineCount === 1);
    return isEligibleShockCount && antiarrhythmicGiven !== AntiarrhythmicDrug.Amiodarone;
  }, [shockCount, lidocaineCount, antiarrhythmicGiven]);

  const timeUntilAdrenaline = useMemo(() => {
    const lastAdrenalineTime = lastAdrenalineTimeRef.current;
    if (lastAdrenalineTime === null) return null;
    const hypothermiaStatus = reversibleCauses.find(item => item.name === "Hypothermia")?.hypothermiaStatus;
    const interval = hypothermiaStatus === HypothermiaStatus.Moderate ? adrenalineInterval * 2 : adrenalineInterval;
    const timeSince = totalArrestTime - lastAdrenalineTime;
    return interval - timeSince;
  }, [totalArrestTime, reversibleCauses, adrenalineInterval]);

  const shouldShowAmiodaroneReminder = useMemo(() => {
    const shockCountDose1 = shockCountForAmiodarone1Ref.current;
    if (shockCountDose1 === null) return false;
    return amiodaroneCount === 1 && shockCount >= shockCountDose1 + 2;
  }, [amiodaroneCount, shockCount]);
  
  const shouldShowAmiodaroneFirstDosePrompt = useMemo(() => {
      return isAmiodaroneAvailable && amiodaroneCount === 0;
  }, [isAmiodaroneAvailable, amiodaroneCount]);

  const shouldShowAdrenalinePrompt = useMemo(() => {
    return shockCount >= 3 && adrenalineCount === 0 && isAdrenalineAvailable;
  }, [shockCount, adrenalineCount, isAdrenalineAvailable]);

  // --- Core Timer Logic ---
  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const tick = () => {
    if (!startTimeRef.current) return;
    
    // 1. Calculate new masterTime (in seconds) and set it.
    // This will trigger a re-render.
    setMasterTime((Date.now() - startTimeRef.current.getTime()) / 1000);
  };

  const startTimer = () => {
    stopTimer();
    // cprCycleStartTimeRef.current = totalArrestTime; // This is set when CPR (re)starts
    timerRef.current = setInterval(tick, 1000);
  };

  // --- Event Logger ---
  const logEvent = (message: string, type: EventType) => {
    const newEvent: Event = { timestamp: totalArrestTime, message, type };
    setEvents(prevEvents => [newEvent, ...prevEvents]);
    HapticManager.impact();
  };

  // --- Undo Logic ---
  const saveUndoState = () => {
    const currentState: UndoState = {
      arrestState, masterTime, cprTime, timeOffset, events,
      shockCount, adrenalineCount, amiodaroneCount, lidocaineCount,
      lastAdrenalineTime: lastAdrenalineTimeRef.current,
      antiarrhythmicGiven,
      shockCountForAmiodarone1: shockCountForAmiodarone1Ref.current,
      airwayPlaced, reversibleCauses, postROSCTasks, postMortemTasks,
      startTime: startTimeRef.current, uiState, patientAgeCategory
    };
    setUndoHistory(prev => [...prev, currentState]);
  };

  const undo = () => {
    if (undoHistory.length === 0) return;
    
    const lastState = undoHistory[undoHistory.length - 1];
    setUndoHistory(prev => prev.slice(0, -1));
    
    setArrestState(lastState.arrestState);
    setMasterTime(lastState.masterTime);
    setCprTime(lastState.cprTime);
    setTimeOffset(lastState.timeOffset);
    setEvents(lastState.events);
    setShockCount(lastState.shockCount);
    setAdrenalineCount(lastState.adrenalineCount);
    setAmiodaroneCount(lastState.amiodaroneCount);
    setLidocaineCount(lastState.lidocaineCount);
    lastAdrenalineTimeRef.current = lastState.lastAdrenalineTime;
    setAntiarrhythmicGiven(lastState.antiarrhythmicGiven);
    shockCountForAmiodarone1Ref.current = lastState.shockCountForAmiodarone1;
    setAirwayPlaced(lastState.airwayPlaced);
    setReversibleCauses(lastState.reversibleCauses);
    setPostROSCTasks(lastState.postROSCTasks);
    setPostMortemTasks(lastState.postMortemTasks);
    startTimeRef.current = lastState.startTime;
    setUiState(lastState.uiState);
    setPatientAgeCategory(lastState.patientAgeCategory);
  };
  
  // --- Timer Lifecycle ---
  useEffect(() => {
    if (arrestState === ArrestState.Active || arrestState === ArrestState.Rosc) {
      startTimer();
    } else {
      stopTimer();
    }
    return stopTimer; // Cleanup on unmount or when arrestState changes
  }, [arrestState]); // ONLY depends on arrestState
  
  // Update CPR Time based on masterTime
  useEffect(() => {
    if (arrestState === ArrestState.Active && uiState === UIState.Default) {
      // This calculation runs on every render where state is active/default,
      // which is triggered by masterTime update every second.
      const newCprTime = cprCycleDuration - (totalArrestTime - cprCycleStartTimeRef.current);

      // Need previous CPR time for haptics.
      setCprTime(prevCprTime => {
          if (newCprTime <= 10 && newCprTime > 0) {
            HapticManager.impact('light');
          }
          
          // Check if the cycle just ended
          if (prevCprTime > 0 && newCprTime <= 0) {
            HapticManager.notification('warning');
          }
          
          // Check if cycle reset is needed
          if (newCprTime < -0.9) {
            cprCycleStartTimeRef.current = totalArrestTime; // Use the *current* totalArrestTime from this render
            return cprCycleDuration;
          }
          
          return newCprTime;
      });
    }
    // This effect depends on totalArrestTime (which depends on masterTime)
  }, [totalArrestTime, arrestState, uiState, cprCycleDuration]); 

  // Update CPR time if duration setting changes
  useEffect(() => {
    setCprTime(cprCycleDuration);
  }, [cprCycleDuration]);

  // --- Core User Actions ---
  const startArrest = () => {
    saveUndoState();
    startTimeRef.current = new Date();
    cprCycleStartTimeRef.current = 0; // totalArrestTime is 0 at this point
    setArrestState(ArrestState.Active);
    logEvent(`Arrest Started at ${new Date().toLocaleTimeString()}`, EventType.Status);
  };

  const analyseRhythm = () => {
    saveUndoState();
    setUiState(UIState.Analyzing);
    logEvent("Rhythm analysis. Pausing CPR.", EventType.Analysis);
  };

  const logRhythm = (rhythm: string, isShockable: boolean) => {
    saveUndoState();
    logEvent(`Rhythm is ${rhythm}`, EventType.Rhythm);
    if (isShockable) {
      setUiState(UIState.ShockAdvised);
    } else {
      resumeCPR();
    }
  };

  const deliverShock = () => {
    saveUndoState();
    setShockCount(c => c + 1);
    logEvent(`Shock ${shockCount + 1} Delivered`, EventType.Shock);
    resumeCPR();
  };

  const resumeCPR = () => {
    if (!startTimeRef.current) return;
        
    // Calculate the *actual* current time, not the stale state one
    const currentMasterTime = (Date.now() - startTimeRef.current.getTime()) / 1000;
    const currentTotalArrestTime = currentMasterTime + timeOffset;

    setUiState(UIState.Default);
    cprCycleStartTimeRef.current = currentTotalArrestTime; // Use the fresh value
    setCprTime(cprCycleDuration);
    logEvent("Resuming CPR.", EventType.Cpr);
  };

  const logAdrenaline = (dosage: string | null = null) => {
    saveUndoState();
    setAdrenalineCount(c => c + 1);
    lastAdrenalineTimeRef.current = totalArrestTime;
    const dosageText = (showDosagePrompts && dosage) ? ` (${dosage})` : "";
    logEvent(`Adrenaline${dosageText} Given - Dose ${adrenalineCount + 1}`, EventType.Drug);
  };

  const logAmiodarone = (dosage: string | null = null) => {
    saveUndoState();
    setAmiodaroneCount(c => c + 1);
    setAntiarrhythmicGiven(AntiarrhythmicDrug.Amiodarone);
    if (amiodaroneCount === 0) {
      shockCountForAmiodarone1Ref.current = shockCount;
    }
    const dosageText = (showDosagePrompts && dosage) ? ` (${dosage})` : "";
    logEvent(`Amiodarone${dosageText} Given - Dose ${amiodaroneCount + 1}`, EventType.Drug);
  };
  
  const logLidocaine = (dosage: string | null = null) => {
    saveUndoState();
    setLidocaineCount(c => c + 1);
    setAntiarrhythmicGiven(AntiarrhythmicDrug.Lidocaine);
    const dosageText = (showDosagePrompts && dosage) ? ` (${dosage})` : "";
    logEvent(`Lidocaine${dosageText} Given - Dose ${lidocaineCount + 1}`, EventType.Drug);
  };

  const logOtherDrug = (drug: string, dosage: string | null = null) => {
    saveUndoState();
    const dosageText = (showDosagePrompts && dosage) ? ` (${dosage})` : "";
    logEvent(`${drug}${dosageText} Given`, EventType.Drug);
  };
  
  const logAirwayPlaced = () => {
    saveUndoState();
    setAirwayPlaced(true);
    logEvent("Advanced Airway Placed", EventType.Airway);
  };

  const logEtco2 = (value: string) => {
    saveUndoState();
    if (value && !isNaN(Number(value)) && Number(value) > 0) {
      logEvent(`ETCO2: ${value} mmHg`, EventType.Etco2);
    }
  };

  const achieveROSC = () => {
    saveUndoState();
    setArrestState(ArrestState.Rosc);
    setUiState(UIState.Default);
    logEvent("Return of Spontaneous Circulation (ROSC)", EventType.Status);
  };

  const endArrest = () => {
    saveUndoState();
    setArrestState(ArrestState.Ended);
    stopTimer();
    logEvent("Arrest Ended (Patient Deceased)", EventType.Status);
  };

  const reArrest = () => {
    if (!startTimeRef.current) return; // Should exist, but good check

    saveUndoState();
    
    // Calculate fresh time values
    const currentMasterTime = (Date.now() - startTimeRef.current.getTime()) / 1000;
    const currentTotalArrestTime = currentMasterTime + timeOffset;
    
    setArrestState(ArrestState.Active);
    cprCycleStartTimeRef.current = currentTotalArrestTime;
    setCprTime(cprCycleDuration);
    logEvent("Patient Re-Arrested. CPR Resumed.", EventType.Status);
  };
  
  const addTimeOffset = (seconds: number) => {
      saveUndoState();
      setTimeOffset(t => t + seconds);
      logEvent(`Time offset added: +${seconds / 60} min`, EventType.Status);
  };

  const toggleChecklistItemCompletion = (item: ChecklistItem) => {
    saveUndoState();
    const updateList = (list: ChecklistItem[]) => 
      list.map(i => i.id === item.id ? { ...i, isCompleted: !i.isCompleted } : i);
      
    setReversibleCauses(updateList);
    setPostROSCTasks(updateList);
    setPostMortemTasks(updateList);
    
    const status = !item.isCompleted ? "checked" : "unchecked";
    logEvent(`${item.name} ${status}`, EventType.Cause);
  };

  const setHypothermiaStatus = (status: HypothermiaStatus) => {
    saveUndoState();
    setReversibleCauses(list => 
      list.map(i => 
        i.name === "Hypothermia" 
        ? { ...i, hypothermiaStatus: status, isCompleted: (status !== HypothermiaStatus.None) } 
        : i
      )
    );
    logEvent(`Hypothermia status set to: ${status}`, EventType.Cause);
  };
  
  const copySummaryToClipboard = () => {
    const summaryText = `
eResus Event Summary
Total Arrest Time: ${TimeFormatter.format(totalArrestTime)}

--- Event Log ---
${[...events].reverse().map(e => `[${TimeFormatter.format(e.timestamp)}] ${e.message}`).join('\n')}
    `;
    navigator.clipboard.writeText(summaryText.trim())
      .then(() => HapticManager.notification('success'))
      .catch(err => console.error("Failed to copy summary: ", err));
  };
  
  const saveLogToDatabase = async () => {
    if (!startTimeRef.current) return;
    
    let finalOutcome: string;
    switch (arrestState) {
      case ArrestState.Rosc: finalOutcome = "ROSC"; break;
      case ArrestState.Ended: finalOutcome = "Deceased"; break;
      default: finalOutcome = "Incomplete";
    }
    
    try {
      // Path for private user data
      const logsCollectionPath = `/artifacts/${appId}/users/${userId}/logs`;
      
      const newLogDoc: Omit<SavedArrestLog, 'id'> = {
        startTime: Timestamp.fromDate(startTimeRef.current),
        totalDuration: totalArrestTime,
        finalOutcome: finalOutcome,
        userId: userId,
      };
      
      const logDocRef = await addDoc(collection(db, logsCollectionPath), newLogDoc);
      
      // Save events as a subcollection
      const eventsCollectionRef = collection(db, `${logsCollectionPath}/${logDocRef.id}/events`);
      for (const event of events) {
        await addDoc(eventsCollectionRef, event);
      }
      
    } catch (e) {
      console.error("Error saving log to Firestore: ", e);
    }
  };
  
  const performReset = async (shouldSaveLog: boolean, shouldCopy: boolean) => {
    if (shouldSaveLog && startTimeRef.current) {
      await saveLogToDatabase();
    }
    if (shouldCopy) {
      copySummaryToClipboard();
    }
    
    stopTimer();
    setArrestState(ArrestState.Pending);
    setMasterTime(0);
    setCprTime(cprCycleDuration);
    setTimeOffset(0);
    setUiState(UIState.Default);
    setEvents([]);
    setShockCount(0);
    setAdrenalineCount(0);
    setAmiodaroneCount(0);
    setLidocaineCount(0);
    setAirwayPlaced(false);
    setAntiarrhythmicGiven(AntiarrhythmicDrug.None);
    lastAdrenalineTimeRef.current = null;
    shockCountForAmiodarone1Ref.current = null;
    startTimeRef.current = null;
    setUndoHistory([]);
    setPatientAgeCategory(null);
    setReversibleCauses(AppConstants.reversibleCausesTemplate());
    setPostROSCTasks(AppConstants.postROSCTasksTemplate());
    setPostMortemTasks(AppConstants.postMortemTasksTemplate());
  };

  return {
    // State
    arrestState, masterTime, cprTime, timeOffset, uiState, events,
    shockCount, adrenalineCount, amiodaroneCount, lidocaineCount,
    airwayPlaced, antiarrhythmicGiven, reversibleCauses, postROSCTasks,
    postMortemTasks, patientAgeCategory,
    
    // Computed
    totalArrestTime, canUndo, isAdrenalineAvailable, isAmiodaroneAvailable,
    isLidocaineAvailable, timeUntilAdrenaline, shouldShowAmiodaroneReminder,
    shouldShowAdrenalinePrompt, shouldShowAmiodaroneFirstDosePrompt,
    
    // Actions
    startArrest, analyseRhythm, logRhythm, deliverShock, resumeCPR,
    logAdrenaline, logAmiodarone, logLidocaine, logOtherDrug, logAirwayPlaced,
    logEtco2, achieveROSC, endArrest, reArrest, addTimeOffset,
    toggleChecklistItemCompletion, setHypothermiaStatus, setPatientAgeCategory,
    performReset, undo, copySummaryToClipboard
  };
};

type ArrestViewModelType = ReturnType<typeof useArrestViewModel>;
const ArrestContext = createContext<ArrestViewModelType | null>(null);
const useArrest = () => useContext(ArrestContext)!;

//============================================================================
// MODAL COMPONENTS (from ModalViews.swift)
//============================================================================

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title: string;
}

const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children }) => {
  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div 
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md mx-auto overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h2>
          <button 
            onClick={onClose} 
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <XSquare size={24} />
          </button>
        </div>
        <div className="p-4 overflow-y-auto max-h-[70vh]">
          {children}
        </div>
      </div>
    </div>
  );
};

const SummaryView: React.FC<{ isOpen: boolean; onClose: () => void; }> = ({ isOpen, onClose }) => {
  const { events, totalArrestTime, copySummaryToClipboard } = useArrest();
  
  const sortedEvents = useMemo(() => 
    [...events].sort((a, b) => a.timestamp - b.timestamp), 
    [events]
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Event Summary">
      <div className="flex flex-col space-y-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          Total Arrest Time: {TimeFormatter.format(totalArrestTime)}
        </h3>
        
        <div className="space-y-2 max-h-60 overflow-y-auto p-2 bg-gray-50 dark:bg-gray-700 rounded-lg font-mono text-sm">
          {sortedEvents.map((event, index) => (
            <div key={index} className="flex">
              <span className={`font-bold w-16 flex-shrink-0 ${getEventTypeColor(event.type)}`}>
                [{TimeFormatter.format(event.timestamp)}]
              </span>
              <span className="ml-2 text-gray-800 dark:text-gray-200">{event.message}</span>
            </div>
          ))}
        </div>
        
        <ActionButton
          title="Copy to Clipboard"
          icon={<Clipboard size={18} />}
          backgroundColor="bg-blue-600"
          foregroundColor="text-white"
          onClick={() => {
            copySummaryToClipboard();
            onClose();
          }}
        />
      </div>
    </Modal>
  );
};

const ResetModalView: React.FC<{ isOpen: boolean; onClose: () => void; }> = ({ isOpen, onClose }) => {
  const { performReset } = useArrest();

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Reset Arrest Log?">
      <div className="flex flex-col items-center text-center space-y-4">
        <RotateCw size={48} className="text-red-500" />
        <p className="text-lg text-gray-700 dark:text-gray-300">
          This will save the current log. This action cannot be undone.
        </p>
        
        <ActionButton
          title="Copy, Save & Reset"
          icon={<Clipboard size={18} />}
          backgroundColor="bg-blue-600"
          foregroundColor="text-white"
          onClick={() => {
            performReset(true, true);
            onClose();
          }}
        />
        <ActionButton
          title="Reset & Save"
          icon={<RotateCw size={18} />}
          backgroundColor="bg-red-600"
          foregroundColor="text-white"
          onClick={() => {
            performReset(true, false);
            onClose();
          }}
        />
        <button
          onClick={onClose}
          className="text-gray-600 dark:text-gray-400 font-medium py-2 px-4 rounded-lg"
        >
          Cancel
        </button>
      </div>
    </Modal>
  );
};

const HypothermiaModal: React.FC<{ isOpen: boolean; onClose: () => void; }> = ({ isOpen, onClose }) => {
  const { setHypothermiaStatus } = useArrest();
  
  const onConfirm = (status: HypothermiaStatus) => {
    setHypothermiaStatus(status);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Set Hypothermia Status">
      <div className="flex flex-col space-y-3">
        <p className="text-center text-gray-600 dark:text-gray-400 mb-2">
          Select the patient's temperature range to apply the correct guidelines.
        </p>
        <ActionButton
          title="Severe (< 30°C)"
          backgroundColor="bg-blue-600"
          foregroundColor="text-white"
          onClick={() => onConfirm(HypothermiaStatus.Severe)}
        />
        <ActionButton
          title="Moderate (30-35°C)"
          backgroundColor="bg-orange-500"
          foregroundColor="text-white"
          onClick={() => onConfirm(HypothermiaStatus.Moderate)}
        />
        <ActionButton
          title="Clear / Normothermic"
          backgroundColor="bg-green-600"
          foregroundColor="text-white"
          onClick={() => onConfirm(HypothermiaStatus.Normothermic)}
        />
      </div>
    </Modal>
  );
};

const OtherDrugsModal: React.FC<{ 
  isOpen: boolean; 
  onClose: () => void; 
  onSelectDrug: (drug: DrugToLog) => void;
}> = ({ isOpen, onClose, onSelectDrug }) => {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Log Other Medication">
      <div className="flex flex-col space-y-2">
        {AppConstants.otherDrugs.map(drug => (
          <button
            key={drug}
            onClick={() => onSelectDrug({ type: 'other', name: drug })}
            className="w-full text-left p-3 bg-gray-50 dark:bg-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-900 dark:text-white"
          >
            {drug}
          </button>
        ))}
      </div>
    </Modal>
  );
};

const Etco2ModalView: React.FC<{ isOpen: boolean; onClose: () => void; }> = ({ isOpen, onClose }) => {
  const { logEtco2 } = useArrest();
  const [value, setValue] = useState("");
  
  const onConfirm = () => {
    logEtco2(value);
    onClose();
    setValue("");
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Log ETCO2 Value">
      <div className="flex flex-col space-y-4">
        <p className="text-center text-gray-600 dark:text-gray-400">
          Enter the current end-tidal CO2 reading in mmHg.
        </p>
        <input
          type="number"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g., 35"
          autoFocus
          className="text-center text-2xl font-bold p-3 border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <ActionButton
          title="Log Value"
          icon={<Gauge size={18} />}
          backgroundColor="bg-blue-600"
          foregroundColor="text-white"
          onClick={onConfirm}
          disabled={!value || isNaN(Number(value))}
        />
      </div>
    </Modal>
  );
};

const DosageEntryModal: React.FC<{ 
  isOpen: boolean; 
  onClose: () => void; 
  drug: DrugToLog;
}> = ({ isOpen, onClose, drug }) => {
  const { logAdrenaline, logAmiodarone, logLidocaine, logOtherDrug, setPatientAgeCategory, amiodaroneCount, patientAgeCategory } = useArrest();
  const [age, setAge] = useState<PatientAgeCategory>(patientAgeCategory || PatientAgeCategory.Adult);
  const [manualAmount, setManualAmount] = useState("");
  const [manualUnit, setManualUnit] = useState("mg");

  const onConfirm = (dosage: string, age: PatientAgeCategory | null) => {
    if (age) {
      setPatientAgeCategory(age);
    }
    
    switch (drug.type) {
      case 'adrenaline': logAdrenaline(dosage); break;
      case 'amiodarone': logAmiodarone(dosage); break;
      case 'lidocaine': logLidocaine(dosage); break;
      case 'other': logOtherDrug(drug.name, dosage); break;
    }
    onClose();
    setManualAmount("");
    setManualUnit("mg");
  };

  const calculatedDose = useMemo(() => {
    if (drug.type === 'adrenaline') {
      return DosageCalculator.calculateAdrenalineDose(age);
    }
    if (drug.type === 'amiodarone') {
      return DosageCalculator.calculateAmiodaroneDose(age, amiodaroneCount + 1);
    }
    return null;
  }, [age, drug, amiodaroneCount]);

  const ManualDosageSection: React.FC<{ onConfirm: (dose: string) => void }> = ({ onConfirm }) => (
    <div className="space-y-3 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
      <h4 className="font-semibold text-gray-800 dark:text-gray-200">Manual Override</h4>
      <div className="flex space-x-2">
        <input
          type="number"
          value={manualAmount}
          onChange={(e) => setManualAmount(e.target.value)}
          placeholder="Amount"
          className="flex-grow p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-md text-gray-900 dark:text-white"
        />
        <select
          value={manualUnit}
          onChange={(e) => setManualUnit(e.target.value)}
          className="p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-md text-gray-900 dark:text-white"
        >
          <option>mg</option>
          <option>mcg</option>
          <option>g</option>
          <option>ml</option>
        </select>
      </div>
      <ActionButton
        title="Log Manual Dose"
        backgroundColor="bg-gray-500"
        foregroundColor="text-white"
        onClick={() => onConfirm(`${manualAmount}${manualUnit}`)}
        disabled={!manualAmount}
      />
    </div>
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Log ${getDrugLogTitle(drug)}`}>
      <div className="flex flex-col space-y-4">
        {(drug.type === 'adrenaline' || drug.type === 'amiodarone') ? (
          <>
            <div className="space-y-2">
              <label className="font-medium text-gray-700 dark:text-gray-300">Patient Age</label>
              <select
                value={age}
                onChange={(e) => setAge(e.target.value as PatientAgeCategory)}
                className="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-md text-gray-900 dark:text-white"
              >
                {allPatientAgeCategories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
            
            <div className="space-y-3 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
              <h4 className="font-semibold text-blue-800 dark:text-blue-200">Calculated Dose</h4>
              {calculatedDose ? (
                <>
                  <p className="text-center text-2xl font-bold text-blue-700 dark:text-blue-300">{calculatedDose}</p>
                  <ActionButton
                    title="Log Calculated Dose"
                    backgroundColor="bg-blue-600"
                    foregroundColor="text-white"
                    onClick={() => onConfirm(calculatedDose, age)}
                  />
                </>
              ) : (
                <p className="text-center text-gray-500 dark:text-gray-400">N/A for this age group.</p>
              )}
            </div>
            
            <ManualDosageSection onConfirm={(dose) => onConfirm(dose, age)} />
          </>
        ) : (
          <ManualDosageSection onConfirm={(dose) => onConfirm(dose, null)} />
        )}
      </div>
    </Modal>
  );
};

//============================================================================
// REUSABLE UI COMPONENTS (from ComponentViews.swift)
//============================================================================

// --- ActionButton ---
interface ActionButtonProps {
  title: string;
  icon?: React.ReactNode;
  backgroundColor: string; // Tailwind bg color class
  foregroundColor: string; // Tailwind text color class
  height?: string; // Tailwind h- class
  fontSize?: string; // Tailwind text- class
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}

const ActionButton: React.FC<ActionButtonProps> = ({
  title,
  icon,
  backgroundColor,
  foregroundColor,
  height = "h-14",
  fontSize = "text-base",
  onClick,
  disabled = false,
  className = ""
}) => {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        flex items-center justify-center space-x-2 w-full px-4 rounded-xl 
        font-semibold shadow-md
        transition-all duration-150 ease-in-out
        active:scale-95 active:shadow-inner
        disabled:opacity-40 disabled:cursor-not-allowed
        ${height} ${fontSize} ${backgroundColor} ${foregroundColor} ${className}
      `}
    >
      {icon}
      <span>{title}</span>
    </button>
  );
};

// --- Header & Timers ---
const HeaderView: React.FC = () => {
  const { arrestState, masterTime, timeOffset, addTimeOffset } = useArrest();
  
  const stateInfo = {
    [ArrestState.Pending]: { text: "PENDING", color: "bg-gray-500" },
    [ArrestState.Active]: { text: "ACTIVE", color: "bg-red-500" },
    [ArrestState.Rosc]: { text: "ROSC", color: "bg-green-500" },
    [ArrestState.Ended]: { text: "DECEASED", color: "bg-black" },
  };

  return (
    <div className="p-4 bg-white dark:bg-gray-800 shadow-md">
      <div className="flex justify-between items-center mb-3">
        {/* This div matches the Swift 'VStack(alignment: .leading, spacing: 4)' */}
        <div className="flex flex-col items-start space-y-1">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">eResus</h1>
          <span
            className={`px-2 py-0.5 rounded-md text-xs font-black text-white ${stateInfo[arrestState].color}`}
          >
            {stateInfo[arrestState].text}
          </span>
        </div>
        
        {/* Timer block - this already matches the Swift 'VStack(alignment: .trailing, spacing: 4)' */}
        <div className="flex flex-col items-end">
          <div className="font-mono font-bold text-4xl text-blue-600 dark:text-blue-400 relative">
            {timeOffset > 0 && (
              <span className="text-xl absolute -left-6 top-0 text-blue-500">
                +{timeOffset / 60}
              </span>
            )}
            {TimeFormatter.format(masterTime)}
          </div>
          {/* This logic is correct per Swift code and user request */}
          {(arrestState === ArrestState.Active || arrestState === ArrestState.Pending) && (
            <div className="flex space-x-1 mt-1">
              <button onClick={() => addTimeOffset(60)} className="px-2 py-0.5 text-xs bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600">+1m</button>
              <button onClick={() => addTimeOffset(300)} className="px-2 py-0.5 text-xs bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600">+5m</button>
              <button onClick={() => addTimeOffset(600)} className="px-2 py-0.5 text-xs bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600">+10m</button>
            </div>
          )}
        </div>
      </div>
      
      {arrestState !== ArrestState.Pending && <CountersView />}
    </div>
  );
};

const CountersView: React.FC = () => {
  const { shockCount, adrenalineCount, amiodaroneCount, lidocaineCount } = useArrest();
  
  return (
    <div className="flex justify-around pt-2 border-t border-gray-200 dark:border-gray-700">
      <CounterItem label="Shocks" value={shockCount} color="text-orange-500" />
      <CounterItem label="Adrenaline" value={adrenalineCount} color="text-pink-500" />
      <CounterItem label="Amiodarone" value={amiodaroneCount} color="text-purple-500" />
      <CounterItem label="Lidocaine" value={lidocaineCount} color="text-indigo-500" />
    </div>
  );
};

const CounterItem: React.FC<{ label: string; value: number; color: string; }> = ({ label, value, color }) => (
  <div className={`flex flex-col items-center ${color}`}>
    <span className="font-mono font-bold text-2xl">{value}</span>
    <span className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">{label}</span>
  </div>
);

const CPRTimerView: React.FC = () => {
  const { cprTime } = useArrest();
  const { cprCycleDuration } = useSettings();
  
  const percentage = (cprTime / cprCycleDuration);
  const strokeDasharray = 2 * Math.PI * 52; // 52 is radius
  const strokeDashoffset = strokeDasharray * (1 - percentage);
  const isEnding = cprTime <= 10;
  
  return (
    <div className="relative w-64 h-64">
      <svg className="w-full h-full" viewBox="0 0 120 120">
        <circle
          className="text-gray-200 dark:text-gray-700"
          strokeWidth="15"
          stroke="currentColor"
          fill="transparent"
          r="52"
          cx="60"
          cy="60"
        />
        <circle
          className={`transition-all duration-1000 linear ${isEnding ? 'text-red-500' : 'text-blue-600'}`}
          strokeWidth="15"
          strokeDasharray={strokeDasharray}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          stroke="currentColor"
          fill="transparent"
          r="52"
          cx="60"
          cy="60"
          transform="rotate(-90 60 60)"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span 
          className={`font-mono font-bold text-6xl ${isEnding ? 'text-red-500' : 'text-gray-900 dark:text-white'}`}
        >
          {TimeFormatter.format(cprTime)}
        </span>
        <span className="text-sm font-semibold uppercase text-gray-500 dark:text-gray-400">CPR Cycle</span>
      </div>
    </div>
  );
};

// --- Screen State Views ---
const PendingView: React.FC<{ onShowPdf: (pdf: PDFIdentifiable) => void }> = ({ onShowPdf }) => {
  const { startArrest } = useArrest();

  return (
    <div className="p-4 space-y-8">
      <ActionButton
        title="Start Arrest"
        backgroundColor="bg-red-600"
        foregroundColor="text-white"
        height="h-20"
        fontSize="text-2xl"
        onClick={startArrest}
      />
      <AlgorithmGridView onShowPdf={onShowPdf} />
    </div>
  );
};

const ActiveArrestContentView: React.FC<{ 
  onShowPdf: (pdf: PDFIdentifiable) => void;
  onShowOtherDrugs: () => void;
  onShowEtco2: () => void;
  onShowHypothermia: () => void;
  onLogAdrenaline: () => void;
  onLogAmiodarone: () => void;
  onLogLidocaine: () => void;
}> = (props) => {
  const {
    cprTime, uiState, timeUntilAdrenaline, shouldShowAdrenalinePrompt,
    shouldShowAmiodaroneFirstDosePrompt, shouldShowAmiodaroneReminder,
    events, reversibleCauses
  } = useArrest();
  const { metronomeBPM } = useSettings();
  const [isMetronomeOn, setIsMetronomeOn] = useState(metronomeService.isPlaying);

  const toggleMetronome = () => {
    const isPlaying = metronomeService.toggle(metronomeBPM);
    setIsMetronomeOn(isPlaying);
  };
  
  useEffect(() => {
    // Sync metronome state if it's stopped externally or component unmounts
    return () => {
      metronomeService.stop();
      setIsMetronomeOn(false);
    };
  }, []);

  return (
    <div className="p-4 space-y-6 pb-40">
      <div className="relative flex justify-center">
        <CPRTimerView />
        <button
          onClick={toggleMetronome}
          className={`absolute bottom-4 right-4 w-12 h-12 rounded-full flex items-center justify-center
          shadow-lg transition-colors
          ${isMetronomeOn ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400'}`}
        >
          {isMetronomeOn ? <Volume2 size={24} /> : <VolumeX size={24} />}
        </button>
      </div>

      {/* --- Timers & Prompts --- */}
      {timeUntilAdrenaline !== null && timeUntilAdrenaline > 0 && (
        <AdrenalineTimerView timeRemaining={timeUntilAdrenaline} />
      )}
      {timeUntilAdrenaline !== null && timeUntilAdrenaline <= 0 && (
        <AdrenalineDueWarning />
      )}
      {shouldShowAdrenalinePrompt && <AdrenalinePromptView />}
      {shouldShowAmiodaroneFirstDosePrompt && <AmiodaronePromptView />}
      {shouldShowAmiodaroneReminder && <AmiodaroneReminderView />}

      {/* --- Action Grids --- */}
      <ActionGridView {...props} />
      
      <AlgorithmGridView onShowPdf={props.onShowPdf} />
      
      <ChecklistView 
        title="Reversible Causes (4 H's & 4 T's)" 
        items={reversibleCauses} 
        onToggle={useArrest().toggleChecklistItemCompletion}
        onHypothermiaClick={props.onShowHypothermia}
      />
      
      <EventLogView events={events} />
    </div>
  );
};

const RoscView: React.FC<{
  onShowPdf: (pdf: PDFIdentifiable) => void;
  onShowOtherDrugs: () => void;
}> = ({ onShowPdf, onShowOtherDrugs }) => {
  const { reArrest, postROSCTasks, toggleChecklistItemCompletion, events } = useArrest();

  return (
    <div className="p-4 space-y-6 pb-40">
      <ActionButton
        title="Patient Re-Arrested"
        icon={<RotateCw size={20} />}
        backgroundColor="bg-orange-500"
        foregroundColor="text-white"
        height="h-16"
        fontSize="text-lg"
        onClick={reArrest}
      />
      <ActionButton
        title="Administer Medication"
        icon={<Syringe size={20} />}
        backgroundColor="bg-gray-600"
        foregroundColor="text-white"
        height="h-16"
        fontSize="text-lg"
        onClick={onShowOtherDrugs}
      />
      
      <ChecklistView 
        title="Post-ROSC Care" 
        items={postROSCTasks} 
        onToggle={toggleChecklistItemCompletion}
      />
      
      <AlgorithmGridView onShowPdf={onShowPdf} />
      <EventLogView events={events} />
    </div>
  );
};

const EndedView: React.FC<{
  onShowPdf: (pdf: PDFIdentifiable) => void;
}> = ({ onShowPdf }) => {
  const { postMortemTasks, toggleChecklistItemCompletion, events } = useArrest();
  
  return (
    <div className="p-4 space-y-6 pb-40">
      <ChecklistView 
        title="Actions Following Death" 
        items={postMortemTasks} 
        onToggle={toggleChecklistItemCompletion}
      />
      <AlgorithmGridView onShowPdf={onShowPdf} />
      <EventLogView events={events} />
    </div>
  );
};

// --- Reusable Components ---

const ActionGridView: React.FC<{
  onShowOtherDrugs: () => void;
  onShowEtco2: () => void;
  onLogAdrenaline: () => void;
  onLogAmiodarone: () => void;
  onLogLidocaine: () => void;
}> = (props) => {
  const { 
    uiState, analyseRhythm, logRhythm, achieveROSC, deliverShock, 
    isAdrenalineAvailable, isAmiodaroneAvailable, isLidocaineAvailable,
    airwayPlaced, logAirwayPlaced, endArrest 
  } = useArrest();
  
  return (
    <div className="space-y-6">
      {/* --- Rhythm Analysis --- */}
      {uiState === UIState.Default && (
        <ActionButton
          title="Analyse Rhythm"
          icon={<Activity size={24} />}
          backgroundColor="bg-blue-600"
          foregroundColor="text-white"
          height="h-20"
          fontSize="text-2xl"
          onClick={analyseRhythm}
        />
      )}
      {uiState === UIState.Analyzing && (
        <div className="p-4 bg-white dark:bg-gray-800 rounded-xl shadow-lg space-y-3">
          <h3 className="text-center font-semibold text-gray-700 dark:text-gray-300">Select Rhythm</h3>
          <div className="grid grid-cols-2 gap-3">
            <ActionButton title="VF" backgroundColor="bg-orange-500" foregroundColor="text-white" onClick={() => logRhythm("VF", true)} />
            <ActionButton title="VT" backgroundColor="bg-orange-500" foregroundColor="text-white" onClick={() => logRhythm("VT", true)} />
            <ActionButton title="PEA" backgroundColor="bg-gray-500" foregroundColor="text-white" onClick={() => logRhythm("PEA", false)} />
            <ActionButton title="Asystole" backgroundColor="bg-gray-500" foregroundColor="text-white" onClick={() => logRhythm("Asystole", false)} />
          </div>
          <ActionButton
            title="ROSC"
            icon={<Heart size={18} />}
            backgroundColor="bg-green-600"
            foregroundColor="text-white"
            onClick={achieveROSC}
            className="col-span-2"
          />
        </div>
      )}
      {uiState === UIState.ShockAdvised && (
        <ActionButton
          title="Deliver Shock"
          icon={<Bolt size={24} />}
          backgroundColor="bg-orange-500"
          foregroundColor="text-white"
          height="h-20"
          fontSize="text-2xl"
          onClick={deliverShock}
        />
      )}
      
      {/* --- Medications --- */}
      <div className="p-4 bg-white dark:bg-gray-800 rounded-xl shadow-lg space-y-3">
        <h3 className="text-center font-semibold text-gray-700 dark:text-gray-300">Medications</h3>
        <div className="grid grid-cols-2 gap-3">
          <ActionButton title="Adrenaline" icon={<Syringe size={18} />} backgroundColor="bg-pink-500" foregroundColor="text-white" onClick={props.onLogAdrenaline} disabled={!isAdrenalineAvailable} />
          <ActionButton title="Amiodarone" icon={<Syringe size={18} />} backgroundColor="bg-purple-600" foregroundColor="text-white" onClick={props.onLogAmiodarone} disabled={!isAmiodaroneAvailable} />
          <ActionButton title="Lidocaine" icon={<Syringe size={18} />} backgroundColor="bg-indigo-600" foregroundColor="text-white" onClick={props.onLogLidocaine} disabled={!isLidocaineAvailable} />
          <ActionButton title="Other Meds..." icon={<Pill size={18} />} backgroundColor="bg-gray-500" foregroundColor="text-white" onClick={props.onShowOtherDrugs} />
        </div>
      </div>
      
      {/* --- Procedures --- */}
      <div className="p-4 bg-white dark:bg-gray-800 rounded-xl shadow-lg space-y-3">
        <h3 className="text-center font-semibold text-gray-700 dark:text-gray-300">Procedures</h3>
        <div className="grid grid-cols-2 gap-3">
          <ActionButton title="Adv. Airway" icon={<AirVent size={18} />} backgroundColor="bg-blue-500" foregroundColor="text-white" onClick={logAirwayPlaced} disabled={airwayPlaced} />
          <ActionButton title="Log ETCO2" icon={<Gauge size={18} />} backgroundColor="bg-teal-500" foregroundColor="text-white" onClick={props.onShowEtco2} />
        </div>
      </div>
      
      {/* --- Patient Status --- */}
      <div className="p-4 bg-white dark:bg-gray-800 rounded-xl shadow-lg space-y-3">
        <h3 className="text-center font-semibold text-gray-700 dark:text-gray-300">Patient Status</h3>
        <div className="grid grid-cols-2 gap-3">
          <ActionButton title="ROSC" icon={<HeartPulse size={18} />} backgroundColor="bg-green-600" foregroundColor="text-white" onClick={achieveROSC} />
          <ActionButton title="End Arrest" icon={<XSquare size={18} />} backgroundColor="bg-red-600" foregroundColor="text-white" onClick={endArrest} />
        </div>
      </div>
    </div>
  );
};

const AdrenalineTimerView: React.FC<{ timeRemaining: number }> = ({ timeRemaining }) => (
  <div className="flex items-center justify-center space-x-2 p-3 rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 font-semibold">
    <Timer size={20} />
    <span>Adrenaline due in: {TimeFormatter.format(timeRemaining)}</span>
  </div>
);

const AdrenalineDueWarning: React.FC = () => (
  <div className="flex items-center justify-center space-x-2 p-3 rounded-lg bg-red-600 text-white font-bold animate-pulse">
    <AlertTriangle size={20} />
    <span>Adrenaline Due</span>
  </div>
);

const AmiodaroneReminderView: React.FC = () => (
  <div className="flex items-center justify-center space-x-2 p-3 rounded-lg bg-purple-600 text-white font-bold animate-pulse">
    <Syringe size={20} />
    <span>Consider 2nd Amiodarone Dose</span>
  </div>
);

const AdrenalinePromptView: React.FC = () => (
  <div className="flex items-center justify-center space-x-2 p-3 rounded-lg bg-pink-500 text-white font-bold animate-pulse">
    <Syringe size={20} />
    <span>Consider giving Adrenaline</span>
  </div>
);

const AmiodaronePromptView: React.FC = () => (
  <div className="flex items-center justify-center space-x-2 p-3 rounded-lg bg-purple-600 text-white font-bold animate-pulse">
    <Syringe size={20} />
    <span>Consider giving Amiodarone</span>
  </div>
);

const ChecklistView: React.FC<{ 
  title: string; 
  items: ChecklistItem[]; 
  onToggle: (item: ChecklistItem) => void;
  onHypothermiaClick?: () => void;
}> = ({ title, items, onToggle, onHypothermiaClick }) => {
  return (
    <div className="p-4 bg-white dark:bg-gray-800 rounded-xl shadow-lg space-y-3">
      <h3 className="font-semibold text-gray-700 dark:text-gray-300">{title}</h3>
      {items.map(item => (
        <ChecklistItemView
          key={item.id}
          item={item}
          onClick={() => (item.name === "Hypothermia" && onHypothermiaClick) ? onHypothermiaClick() : onToggle(item)}
        />
      ))}
    </div>
  );
};

const ChecklistItemView: React.FC<{ item: ChecklistItem; onClick: () => void; }> = ({ item, onClick }) => (
  <button onClick={onClick} className="flex items-center w-full text-left space-x-3 group">
    {item.isCompleted ? (
      <CheckCircle2 size={24} className="text-green-500 flex-shrink-0" />
    ) : (
      <Circle size={24} className="text-gray-400 dark:text-gray-500 group-hover:text-gray-600 dark:group-hover:text-gray-300 flex-shrink-0" />
    )}
    <span className={`text-gray-900 dark:text-white ${item.isCompleted ? 'line-through' : ''}`}>
      {item.name}
    </span>
    {item.hypothermiaStatus !== HypothermiaStatus.None && item.hypothermiaStatus !== HypothermiaStatus.Normothermic && (
      <span className={`text-xs font-bold ${item.hypothermiaStatus === HypothermiaStatus.Severe ? 'text-blue-500' : 'text-orange-500'}`}>
        ({item.hypothermiaStatus})
      </span>
    )}
  </button>
);

const EventLogView: React.FC<{ events: Event[] }> = ({ events }) => (
  <div className="p-4 bg-white dark:bg-gray-800 rounded-xl shadow-lg space-y-3">
    <h3 className="font-semibold text-gray-700 dark:text-gray-300">Event Log</h3>
    <div className="space-y-2 max-h-60 overflow-y-auto font-mono text-sm">
      {events.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400 italic">No events logged yet.</p>
      ) : (
        events.map((event, index) => (
          <div key={index} className="flex">
            <span className={`font-bold w-16 flex-shrink-0 ${getEventTypeColor(event.type)}`}>
              [{TimeFormatter.format(event.timestamp)}]
            </span>
            <span className="ml-2 text-gray-800 dark:text-gray-200">{event.message}</span>
          </div>
        ))
      )}
    </div>
  </div>
);

const AlgorithmGridView: React.FC<{ onShowPdf: (pdf: PDFIdentifiable) => void; }> = ({ onShowPdf }) => (
  <div className="p-4 bg-white dark:bg-gray-800 rounded-xl shadow-lg space-y-3">
    <h3 className="text-center font-semibold text-gray-700 dark:text-gray-300">Resuscitation Council UK</h3>
    <div className="grid grid-cols-2 gap-3">
      {AppConstants.pdfAlgorithms.map(pdf => (
        <button
          key={pdf.id}
          onClick={() => onShowPdf(pdf)}
          className="p-3 h-20 flex items-center justify-center text-center font-semibold
           bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg
           hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
        >
          {pdf.title}
        </button>
      ))}
    </div>
  </div>
);

const BottomControlsView: React.FC<{
  onShowSummary: () => void;
  onShowReset: () => void;
}> = ({ onShowSummary, onShowReset }) => {
  const { undo, canUndo } = useArrest();
  
  return (
    <div className="fixed bottom-16 left-0 right-0 p-3 bg-white/80 dark:bg-gray-900/80 backdrop-blur-md border-t border-gray-200 dark:border-gray-700 z-30">
      <div className="flex space-x-3">
        <ActionButton
          title="Undo"
          icon={<Undo size={18} />}
          backgroundColor="bg-gray-200 dark:bg-gray-700"
          foregroundColor="text-gray-800 dark:text-gray-200"
          onClick={undo}
          disabled={!canUndo}
        />
        <ActionButton
          title="Summary"
          icon={<Clipboard size={18} />}
          backgroundColor="bg-blue-600"
          foregroundColor="text-white"
          onClick={onShowSummary}
        />
        <ActionButton
          title="Reset"
          icon={<RotateCw size={18} />}
          backgroundColor="bg-red-600"
          foregroundColor="text-white"
          onClick={onShowReset}
        />
      </div>
    </div>
  );
};

// Helper for event log colors
const getEventTypeColor = (type: EventType): string => {
  switch (type) {
    case EventType.Status: return "text-green-500";
    case EventType.Cpr: return "text-cyan-500";
    case EventType.Shock: return "text-orange-500";
    case EventType.Analysis: return "text-blue-500";
    case EventType.Rhythm: return "text-purple-500";
    case EventType.Drug: return "text-pink-500";
    case EventType.Airway: return "text-teal-500";
    case EventType.Etco2: return "text-indigo-500";
    case EventType.Cause: return "text-gray-500";
    default: return "text-gray-800 dark:text-gray-200";
  }
};

//============================================================================
// MAIN VIEWS (from ArrestView.swift, LogbookView.swift, SettingsView.swift)
//============================================================================

// --- ArrestView ---
const ArrestView: React.FC<{
  onShowPdf: (pdf: PDFIdentifiable) => void;
}> = ({ onShowPdf }) => {
  const viewModel = useArrest();
  const { showDosagePrompts, setPatientAgeCategory } = useSettings();
  
  const [showOtherDrugsModal, setShowOtherDrugsModal] = useState(false);
  const [showEtco2Modal, setShowEtco2Modal] = useState(false);
  const [showHypothermiaModal, setShowHypothermiaModal] = useState(false);
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [drugToLog, setDrugToLog] = useState<DrugToLog | null>(null);
  
  // Drug Confirmation Alert State
  const [drugConfirmation, setDrugConfirmation] = useState<{ drug: DrugToLog, dose: string } | null>(null);

  const handleLogDrug = (drug: DrugToLog) => {
    if (showDosagePrompts) {
      if (viewModel.patientAgeCategory && (drug.type === 'adrenaline' || drug.type === 'amiodarone')) {
        let dose: string | null = null;
        if (drug.type === 'adrenaline') {
          dose = DosageCalculator.calculateAdrenalineDose(viewModel.patientAgeCategory);
        } else {
          dose = DosageCalculator.calculateAmiodaroneDose(viewModel.patientAgeCategory, viewModel.amiodaroneCount + 1);
        }
        
        if (dose) {
          setDrugConfirmation({ drug, dose });
          return;
        }
      }
      // If no patient age or not Adr/Amio, go to full modal
      setDrugToLog(drug);
    } else {
      // No prompts, just log it
      switch (drug.type) {
        case 'adrenaline': viewModel.logAdrenaline(); break;
        case 'amiodarone': viewModel.logAmiodarone(); break;
        case 'lidocaine': viewModel.logLidocaine(); break;
        case 'other': viewModel.logOtherDrug(drug.name); break;
      }
    }
  };

  const handleConfirmDrug = (confirmed: boolean) => {
    if (drugConfirmation && confirmed) {
      switch (drugConfirmation.drug.type) {
        case 'adrenaline': viewModel.logAdrenaline(drugConfirmation.dose); break;
        case 'amiodarone': viewModel.logAmiodarone(drugConfirmation.dose); break;
      }
    } else if (drugConfirmation) {
      // User clicked "Change", open full modal
      setDrugToLog(drugConfirmation.drug);
    }
    setDrugConfirmation(null);
  };
  
  const handleSelectOtherDrug = (drug: DrugToLog) => {
    setShowOtherDrugsModal(false);
    handleLogDrug(drug);
  };

  return (
    <div className="flex flex-col h-full">
      <HeaderView />
      
      <div className="flex-grow overflow-y-auto bg-gray-100 dark:bg-gray-900">
        {viewModel.arrestState === ArrestState.Pending && <PendingView onShowPdf={onShowPdf} />}
        {viewModel.arrestState === ArrestState.Active && (
          <ActiveArrestContentView
            onShowPdf={onShowPdf}
            onShowOtherDrugs={() => setShowOtherDrugsModal(true)}
            onShowEtco2={() => setShowEtco2Modal(true)}
            onShowHypothermia={() => setShowHypothermiaModal(true)}
            onLogAdrenaline={() => handleLogDrug({ type: 'adrenaline' })}
            onLogAmiodarone={() => handleLogDrug({ type: 'amiodarone' })}
            onLogLidocaine={() => handleLogDrug({ type: 'lidocaine' })}
          />
        )}
        {viewModel.arrestState === ArrestState.Rosc && (
          <RoscView 
            onShowPdf={onShowPdf}
            onShowOtherDrugs={() => setShowOtherDrugsModal(true)}
          />
        )}
        {viewModel.arrestState === ArrestState.Ended && <EndedView onShowPdf={onShowPdf} />}
      </div>
      
      {viewModel.arrestState !== ArrestState.Pending && (
        <BottomControlsView 
          onShowSummary={() => setShowSummaryModal(true)}
          onShowReset={() => setShowResetModal(true)}
        />
      )}
      
      {/* --- Modals --- */}
      <SummaryView isOpen={showSummaryModal} onClose={() => setShowSummaryModal(false)} />
      <ResetModalView isOpen={showResetModal} onClose={() => setShowResetModal(false)} />
      <HypothermiaModal isOpen={showHypothermiaModal} onClose={() => setShowHypothermiaModal(false)} />
      <Etco2ModalView isOpen={showEtco2Modal} onClose={() => setShowEtco2Modal(false)} />
      <OtherDrugsModal 
        isOpen={showOtherDrugsModal} 
        onClose={() => setShowOtherDrugsModal(false)} 
        onSelectDrug={handleSelectOtherDrug}
      />
      {drugToLog && (
        <DosageEntryModal 
          isOpen={!!drugToLog}
          onClose={() => setDrugToLog(null)}
          drug={drugToLog}
        />
      )}
      
      {/* --- Drug Confirmation Alert --- */}
      {drugConfirmation && (
        <Modal isOpen={!!drugConfirmation} onClose={() => setDrugConfirmation(null)} title="Confirm Dosage">
          <div className="text-center space-y-4">
            <p className="text-lg text-gray-800 dark:text-gray-200">
              Confirm <span className="font-bold">{drugConfirmation.dose}</span> {getDrugLogTitle(drugConfirmation.drug)} given?
            </p>
            <div className="flex space-x-3">
              <ActionButton title="Cancel" backgroundColor="bg-gray-200 dark:bg-gray-700" foregroundColor="text-gray-800 dark:text-gray-200" onClick={() => handleConfirmDrug(false)} />
              <ActionButton title="Change" backgroundColor="bg-orange-500" foregroundColor="text-white" onClick={() => handleConfirmDrug(false)} />
              <ActionButton title="Confirm" backgroundColor="bg-blue-600" foregroundColor="text-white" onClick={() => handleConfirmDrug(true)} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

// --- LogbookView ---
const LogbookView: React.FC = () => {
  const { db, userId } = useFirebase();
  const [logs, setLogs] = useState<SavedArrestLog[]>([]);
  const [selectedLog, setSelectedLog] = useState<SavedArrestLog | null>(null);
  const [selectedLogEvents, setSelectedLogEvents] = useState<Event[]>([]);
  
  useEffect(() => {
    const logsCollectionPath = `/artifacts/${appId}/users/${userId}/logs`;
    const q = query(collection(db, logsCollectionPath), where("userId", "==", userId));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedLogs: SavedArrestLog[] = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as SavedArrestLog));
      // Sort in memory
      fetchedLogs.sort((a, b) => b.startTime.toMillis() - a.startTime.toMillis());
      setLogs(fetchedLogs);
    }, (error) => {
      console.error("Error fetching logs: ", error);
    });
    
    return () => unsubscribe();
  }, [db, userId]);

  const openLog = async (log: SavedArrestLog) => {
    if (!log.id) return;
    setSelectedLog(log);
    try {
      const eventsCollectionPath = `/artifacts/${appId}/users/${userId}/logs/${log.id}/events`;
      const eventsSnapshot = await getDocs(collection(db, eventsCollectionPath));
      const fetchedEvents: Event[] = eventsSnapshot.docs.map(doc => doc.data() as Event);
      fetchedEvents.sort((a, b) => a.timestamp - b.timestamp);
      setSelectedLogEvents(fetchedEvents);
    } catch (e) {
      console.error("Error fetching log events: ", e);
      setSelectedLogEvents([]);
    }
  };

  const deleteLog = async (logId: string) => {
    if (window.confirm("Are you sure you want to delete this log?")) {
      try {
        // Note: Deleting subcollections is complex. This only deletes the main log doc.
        // A full implementation would need a cloud function to delete subcollections.
        const logDocPath = `/artifacts/${appId}/users/${userId}/logs/${logId}`;
        await deleteDoc(doc(db, logDocPath));
      } catch (e) {
        console.error("Error deleting log: ", e);
      }
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 bg-white dark:bg-gray-800 shadow-md">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Logbook</h1>
      </div>
      
      <div className="flex-grow overflow-y-auto bg-gray-100 dark:bg-gray-900 p-4 space-y-3">
        {logs.length === 0 && (
          <p className="text-center text-gray-500 dark:text-gray-400 pt-10">No saved logs.</p>
        )}
        {logs.map(log => (
          <div key={log.id} className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow flex justify-between items-center">
            <button onClick={() => openLog(log)} className="flex-grow text-left">
              <h3 className="font-semibold text-gray-900 dark:text-white">{log.startTime.toDate().toLocaleDateString()}</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {log.startTime.toDate().toLocaleTimeString()}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                Duration: {TimeFormatter.format(log.totalDuration)} | Outcome: {log.finalOutcome}
              </p>
            </button>
            <button 
              onClick={() => log.id && deleteLog(log.id)}
              className="p-2 text-red-500 hover:text-red-700"
            >
              <XSquare size={20} />
            </button>
          </div>
        ))}
      </div>
      
      {/* Log Detail Modal */}
      {selectedLog && (
        <Modal 
          isOpen={!!selectedLog} 
          onClose={() => setSelectedLog(null)} 
          title="Log Summary"
        >
          <div className="flex flex-col space-y-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              Total Arrest Time: {TimeFormatter.format(selectedLog.totalDuration)}
            </h3>
            
            <div className="space-y-2 max-h-60 overflow-y-auto p-2 bg-gray-50 dark:bg-gray-700 rounded-lg font-mono text-sm">
              {selectedLogEvents.map((event, index) => (
                <div key={index} className="flex">
                  <span className={`font-bold w-16 flex-shrink-0 ${getEventTypeColor(event.type)}`}>
                    [{TimeFormatter.format(event.timestamp)}]
                  </span>
                  <span className="ml-2 text-gray-800 dark:text-gray-200">{event.message}</span>
                </div>
              ))}
            </div>
            
            <ActionButton
              title="Close"
              backgroundColor="bg-blue-600"
              foregroundColor="text-white"
              onClick={() => setSelectedLog(null)}
            />
          </div>
        </Modal>
      )}
    </div>
  );
};

// --- SettingsView ---
const SettingsView: React.FC = () => {
  const {
    cprCycleDuration, setCprCycleDuration,
    adrenalineInterval, setAdrenalineInterval,
    metronomeBPM, setMetronomeBPM,
    appearanceMode, setAppearanceMode,
    showDosagePrompts, setShowDosagePrompts,
  } = useSettings();

  const appearanceOptions = [
    { value: AppearanceMode.System, label: "System", icon: <Laptop size={20} /> },
    { value: AppearanceMode.Light, label: "Light", icon: <Sun size={20} /> },
    { value: AppearanceMode.Dark, label: "Dark", icon: <Moon size={20} /> },
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 bg-white dark:bg-gray-800 shadow-md">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
      </div>
      
      <div className="flex-grow overflow-y-auto bg-gray-100 dark:bg-gray-900 p-4 space-y-6">
        {/* --- Timers --- */}
        <div className="p-4 bg-white dark:bg-gray-800 rounded-xl shadow-lg space-y-4">
          <h3 className="font-semibold text-gray-700 dark:text-gray-300">Timers</h3>
          <SettingStepper
            label="CPR Cycle"
            value={cprCycleDuration}
            onChange={setCprCycleDuration}
            min={60} max={300} step={10}
            unit="seconds"
          />
          <SettingStepper
            label="Adrenaline Interval"
            value={adrenalineInterval / 60}
            onChange={(val) => setAdrenalineInterval(val * 60)}
            min={2} max={10} step={1}
            unit="minutes"
          />
        </div>
        
        {/* --- Metronome --- */}
        <div className="p-4 bg-white dark:bg-gray-800 rounded-xl shadow-lg space-y-4">
          <h3 className="font-semibold text-gray-700 dark:text-gray-300">Metronome</h3>
          <SettingStepper
            label="BPM"
            value={metronomeBPM}
            onChange={setMetronomeBPM}
            min={80} max={140} step={5}
            unit="BPM"
          />
        </div>
        
        {/* --- Medications --- */}
        <div className="p-4 bg-white dark:bg-gray-800 rounded-xl shadow-lg space-y-4">
          <h3 className="font-semibold text-gray-700 dark:text-gray-300">Medications</h3>
          <SettingToggle
            label="Show Dosage Prompts"
            enabled={showDosagePrompts}
            onChange={setShowDosagePrompts}
            description="When enabled, the app will ask for patient age or a manual dose when you log Adrenaline, Amiodarone, or other drugs."
          />
        </div>
        
        {/* --- Appearance --- */}
        <div className="p-4 bg-white dark:bg-gray-800 rounded-xl shadow-lg space-y-4">
          <h3 className="font-semibold text-gray-700 dark:text-gray-300">Appearance</h3>
          <div className="flex space-x-2">
            {appearanceOptions.map(opt => (
              <button
                key={opt.value}
                onClick={() => setAppearanceMode(opt.value)}
                className={`flex-1 flex flex-col items-center space-y-1 p-3 rounded-lg border-2
                ${appearanceMode === opt.value 
                  ? 'bg-blue-100 dark:bg-blue-900 border-blue-500 text-blue-700 dark:text-blue-300' 
                  : 'bg-gray-100 dark:bg-gray-700 border-transparent text-gray-600 dark:text-gray-400'
                }`}
              >
                {opt.icon}
                <span className="text-sm font-medium">{opt.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const SettingStepper: React.FC<{
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  unit: string;
}> = ({ label, value, onChange, min, max, step, unit }) => (
  <div className="flex justify-between items-center">
    <span className="text-gray-800 dark:text-gray-200">{label}</span>
    <div className="flex items-center space-x-3">
      <button 
        onClick={() => onChange(Math.max(min, value - step))} 
        disabled={value <= min}
        className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 disabled:opacity-50"
      >
        <Minus size={16} className="mx-auto" />
      </button>
      <span className="font-semibold w-20 text-center text-gray-900 dark:text-white">{value} {unit}</span>
      <button 
        onClick={() => onChange(Math.min(max, value + step))} 
        disabled={value >= max}
        className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 disabled:opacity-50"
      >
        <Plus size={16} className="mx-auto" />
      </button>
    </div>
  </div>
);

const SettingToggle: React.FC<{
  label: string;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  description: string;
}> = ({ label, enabled, onChange, description }) => (
  <div className="space-y-2">
    <div className="flex justify-between items-center">
      <span className="text-gray-800 dark:text-gray-200">{label}</span>
      <button
        onClick={() => onChange(!enabled)}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent 
        transition-colors duration-200 ease-in-out focus:outline-none
        ${enabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 
          transition duration-200 ease-in-out
          ${enabled ? 'translate-x-5' : 'translate-x-0'}`}
        />
      </button>
    </div>
    <p className="text-sm text-gray-500 dark:text-gray-400">{description}</p>
  </div>
);

//============================================================================
// PDF VIEWER (from PDFKitView.swift)
//============================================================================
const PDFView: React.FC<{ pdf: PDFIdentifiable; onClose: () => void; }> = ({ pdf, onClose }) => {
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex flex-col p-4">
      <div className="flex justify-between items-center mb-4 flex-shrink-0">
        <h2 className="text-xl font-semibold text-white">{pdf.title}</h2>
        <button onClick={onClose} className="px-4 py-2 bg-blue-600 text-white rounded-lg">
          Done
        </button>
      </div>
      <iframe
        src={pdf.pdfUrl}
        title={pdf.title}
        className="w-full h-full flex-grow rounded-lg border-4 border-gray-300"
      />
    </div>
  );
};


//============================================================================
// APP ENTRY POINT (from MainTabView.swift & eResusApp.swift)
//============================================================================

type TabID = 'arrest' | 'logbook' | 'settings';

// This new component contains the main UI and can safely consume contexts
const AppContent: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<TabID>('arrest');
  const [pdfToShow, setPdfToShow] = useState<PDFIdentifiable | null>(null);
  
  // These hooks will now work because their providers are parents
  const arrestViewModel = useArrestViewModel();
  const { appearanceMode } = useSettings();

  // Apply dark mode
  useEffect(() => {
    const root = window.document.documentElement;
    if (appearanceMode === AppearanceMode.Dark || 
        (appearanceMode === AppearanceMode.System && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [appearanceMode]);

  const renderTab = () => {
    switch (currentTab) {
      case 'arrest':
        return <ArrestView onShowPdf={setPdfToShow} />;
      case 'logbook':
        return <LogbookView />;
      case 'settings':
        return <SettingsView />;
    }
  };

  return (
    <ArrestContext.Provider value={arrestViewModel}>
      <div className="h-screen w-screen flex flex-col font-sans">
        {/* Main Content */}
        <main className="flex-grow overflow-hidden">
          {renderTab()}
        </main>
        
        {/* Tab Bar */}
        <nav className="flex justify-around p-2 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 z-20">
          <TabButton
            label="Arrest"
            icon={<HeartPulse size={24} />}
            isActive={currentTab === 'arrest'}
            onClick={() => setCurrentTab('arrest')}
          />
          <TabButton
            label="Logbook"
            icon={<Book size={24} />}
            isActive={currentTab === 'logbook'}
            onClick={() => setCurrentTab('logbook')}
          />
          <TabButton
            label="Settings"
            icon={<Settings size={24} />}
            isActive={currentTab === 'settings'}
            onClick={() => setCurrentTab('settings')}
          />
        </nav>

        {/* PDF Viewer Modal */}
        {pdfToShow && <PDFView pdf={pdfToShow} onClose={() => setPdfToShow(null)} />}
      </div>
    </ArrestContext.Provider>
  );
}

const App: React.FC = () => {
  const settings = useAppSettings(); // This hook provides the settings value

  return (
    <AppSettingsContext.Provider value={settings}>
      <AppContent /> {/* AppContent and its children can now consume the settings context */}
    </AppSettingsContext.Provider>
  );
};

const TabButton: React.FC<{
  label: string;
  icon: React.ReactNode;
  isActive: boolean;
  onClick: () => void;
}> = ({ label, icon, isActive, onClick }) => (
  <button
    onClick={onClick}
    className={`flex flex-col items-center w-20 p-1 rounded-lg transition-colors
    ${isActive 
      ? 'text-blue-600 dark:text-blue-400' 
      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
    }`}
  >
    {icon}
    <span className="text-xs font-medium">{label}</span>
  </button>
);

// Main export wrapped in Providers
const AppWrapper: React.FC = () => (
  <FirebaseProvider>
    <App />
  </FirebaseProvider>
);

export default AppWrapper;




