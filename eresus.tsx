import React, { useState, useEffect, useRef, createContext, useContext, useMemo } from 'react';
// Firebase Firestore and App imports
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  onSnapshot,
  collection,
  query,
  addDoc,
  setLogLevel,
  Firestore
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
// Lucide Icons
import {
  Heart,
  HeartPulse,
  Settings,
  Book,
  Undo,
  Clipboard,
  RotateCw,
  Zap,
  Syringe,
  Pill,
  AirVent,
  Activity,
  XSquare,
  Play,
  StopCircle,
  AlertTriangle,
  FileText,
  Plus,
  Minus,
  Check,
  ChevronDown,
  X,
  Clock,
  Music,
  CheckCircle,
  Laptop,
  Download, // For PWA Install
  RefreshCw, // For PWA Update
  Share // For iOS Share icon
} from 'lucide-react';

//============================================================================
// GLOBAL FIREBASE CONFIG & APP ID
//============================================================================

// These are provided by the canvas environment or need to be set manually
declare const __app_id: string;
declare const __firebase_config: string;

const appId = typeof __app_id !== 'undefined' ? __app_id : 'eResus-web-app'; // Default App ID if not provided
const firebaseConfig = JSON.parse(typeof __firebase_config !== 'undefined' ? __firebase_config : '{}');

let db: Firestore | null = null; // Initialize as null

//============================================================================
// DEVICE ID MANAGEMENT
//============================================================================

const DEVICE_ID_KEY = 'eResusDeviceId';

function getDeviceId(): string {
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
    console.log("Generated new Device ID:", deviceId);
  } else {
    console.log("Using existing Device ID:", deviceId);
  }
  return deviceId;
}

//============================================================================
// TYPE DEFINITIONS
//============================================================================

// --- Enums and Basic Types ---
enum ArrestState { Pending = "PENDING", Active = "ACTIVE", Rosc = "ROSC", Ended = "ENDED" }
enum UIState { Default = "DEFAULT", Analyzing = "ANALYZING", ShockAdvised = "SHOCK_ADVISED" }
enum EventType { Status = "STATUS", Cpr = "CPR", Shock = "SHOCK", Analysis = "ANALYSIS", Rhythm = "RHYTHM", Drug = "DRUG", Airway = "AIRWAY", Etco2 = "ETCO2", Cause = "CAUSE" }
enum AntiarrhythmicDrug { None = "NONE", Amiodarone = "AMIODARONE", Lidocaine = "LIDOCAINE" }
enum HypothermiaStatus { None = "NONE", Severe = "SEVERE", Moderate = "MODERATE", Normothermic = "NORMOTHERMIC" }
enum AppearanceMode { System = "System", Light = "Light", Dark = "Dark" }
enum DrugToLogType { Adrenaline, Amiodarone, Lidocaine, Other }

// --- Complex Types ---
type DrugToLog =
  { type: DrugToLogType.Adrenaline, title: 'Adrenaline' } |
  { type: DrugToLogType.Amiodarone, title: 'Amiodarone' } |
  { type: DrugToLogType.Lidocaine, title: 'Lidocaine' } |
  { type: DrugToLogType.Other, title: string };

type ChecklistItem = {
  id: string;
  name: string;
  isCompleted: boolean;
  hypothermiaStatus: HypothermiaStatus;
};

type EventLog = {
  id: string;
  timestamp: number;
  message: string;
  type: EventType;
};

// Structure for Firestore documents
type ArrestDocument = {
  startTime: number | null;
  totalDuration: number;
  finalOutcome: string;
  events: EventLog[];
  // Include other relevant state to persist if needed
  arrestState?: ArrestState;
  masterTime?: number;
  cprTime?: number;
  timeOffset?: number;
  uiState?: UIState;
  shockCount?: number;
  adrenalineCount?: number;
  amiodaroneCount?: number;
  lidocaineCount?: number;
  airwayPlaced?: boolean;
  antiarrhythmicGiven?: AntiarrhythmicDrug;
  lastAdrenalineTime?: number | null;
  shockCountForAmiodarone1?: number | null;
  reversibleCauses?: ChecklistItem[];
  postROSCTasks?: ChecklistItem[];
  postMortemTasks?: ChecklistItem[];
  patientAgeCategory?: PatientAgeCategory | null;
  cprCycleStartTime?: number;
};

type PDFIdentifiable = {
  id: string;
  pdfName: string;
  title: string;
};

//============================================================================
// APP CONSTANTS & SETTINGS
//============================================================================

// --- Templates and Constants ---
const AppConstants = {
  reversibleCausesTemplate: [
    { id: "hypoxia", name: "Hypoxia", isCompleted: false, hypothermiaStatus: HypothermiaStatus.None },
    { id: "hypovolemia", name: "Hypovolemia", isCompleted: false, hypothermiaStatus: HypothermiaStatus.None },
    { id: "hypo-hyperkalaemia", name: "Hypo/Hyperkalaemia", isCompleted: false, hypothermiaStatus: HypothermiaStatus.None },
    { id: "hypothermia", name: "Hypothermia", isCompleted: false, hypothermiaStatus: HypothermiaStatus.None },
    { id: "toxins", name: "Toxins", isCompleted: false, hypothermiaStatus: HypothermiaStatus.None },
    { id: "tamponade", name: "Tamponade", isCompleted: false, hypothermiaStatus: HypothermiaStatus.None },
    { id: "tension-pneumothorax", name: "Tension Pneumothorax", isCompleted: false, hypothermiaStatus: HypothermiaStatus.None },
    { id: "thrombosis", name: "Thrombosis", isCompleted: false, hypothermiaStatus: HypothermiaStatus.None }
  ],
  postROSCTasksTemplate: [
    { id: "ventilation", name: "Optimise Ventilation & Oxygenation", isCompleted: false, hypothermiaStatus: HypothermiaStatus.None },
    { id: "ecg", name: "12-Lead ECG", isCompleted: false, hypothermiaStatus: HypothermiaStatus.None },
    { id: "hypotension", name: "Treat Hypotension (SBP < 90)", isCompleted: false, hypothermiaStatus: HypothermiaStatus.None },
    { id: "glucose", name: "Check Blood Glucose", isCompleted: false, hypothermiaStatus: HypothermiaStatus.None },
    { id: "temp", name: "Consider Temperature Control", isCompleted: false, hypothermiaStatus: HypothermiaStatus.None },
    { id: "causes", name: "Identify & Treat Causes", isCompleted: false, hypothermiaStatus: HypothermiaStatus.None }
  ],
  postMortemTasksTemplate: [
    { id: "reposition", name: "Reposition body & remove lines/tubes", isCompleted: false, hypothermiaStatus: HypothermiaStatus.None },
    { id: "documentation", name: "Complete documentation", isCompleted: false, hypothermiaStatus: HypothermiaStatus.None },
    { id: "expected", name: "Determine expected/unexpected death", isCompleted: false, hypothermiaStatus: HypothermiaStatus.None },
    { id: "coroner", name: "Contact Coroner (if unexpected)", isCompleted: false, hypothermiaStatus: HypothermiaStatus.None },
    { id: "procedure", name: "Follow local body handling procedure", isCompleted: false, hypothermiaStatus: HypothermiaStatus.None },
    { id: "leaflet", name: "Provide leaflet to bereaved relatives", isCompleted: false, hypothermiaStatus: HypothermiaStatus.None },
    { id: "donation", name: "Consider organ/tissue donation", isCompleted: false, hypothermiaStatus: HypothermiaStatus.None }
  ],
  otherDrugs: [
    "Adenosine", "Adrenaline 1:1000", "Adrenaline 1:10,000", "Amiodarone (Further Dose)",
    "Atropine", "Calcium chloride", "Glucose", "Hartmann’s solution", "Magnesium sulphate",
    "Midazolam", "Naloxone", "Potassium chloride", "Sodium bicarbonate", "Sodium chloride", "Tranexamic acid"
  ].sort()
};

// --- Settings Management ---
const defaultSettings = {
  cprCycleDuration: 120,
  adrenalineInterval: 240,
  metronomeBPM: 110,
  appearanceMode: AppearanceMode.System,
  showDosagePrompts: false,
};
type AppSettings = typeof defaultSettings;
const AppSettingsContext = createContext<AppSettings>(defaultSettings);

const useAppStorage = <T,>(key: string, defaultValue: T): [T, (value: T) => void] => {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : defaultValue;
    } catch (error) { console.error(error); return defaultValue; }
  });
  const setValue = (value: T) => {
    try {
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
      window.localStorage.setItem(key, JSON.stringify(valueToStore));
    } catch (error) { console.error(error); }
  };
  return [storedValue, setValue];
};

const AppSettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [cprCycleDuration] = useAppStorage('cprCycleDuration', defaultSettings.cprCycleDuration);
  const [adrenalineInterval] = useAppStorage('adrenalineInterval', defaultSettings.adrenalineInterval);
  const [metronomeBPM] = useAppStorage('metronomeBPM', defaultSettings.metronomeBPM);
  const [appearanceMode] = useAppStorage('appearanceMode', defaultSettings.appearanceMode);
  const [showDosagePrompts] = useAppStorage('showDosagePrompts', defaultSettings.showDosagePrompts);
  const value = useMemo(() => ({ cprCycleDuration, adrenalineInterval, metronomeBPM, appearanceMode, showDosagePrompts }), [cprCycleDuration, adrenalineInterval, metronomeBPM, appearanceMode, showDosagePrompts]);
  return <AppSettingsContext.Provider value={value}>{children}</AppSettingsContext.Provider>;
};
const useSettings = () => useContext(AppSettingsContext);

//============================================================================
// APP SERVICES
//============================================================================
const TimeFormatter = {
  format: (timeInterval: number): string => {
    const time = Math.max(0, Math.floor(timeInterval));
    const minutes = Math.floor(time / 60);
    const seconds = time % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
};
const HapticManager = {
  impact: (style: 'light' | 'medium' | 'heavy' = 'light') => {
    if (window.navigator.vibrate) {
      const duration = style === 'light' ? 20 : (style === 'medium' ? 40 : 60);
      window.navigator.vibrate(duration);
    }
  },
  notification: (type: 'success' | 'warning' | 'error') => {
    if (window.navigator.vibrate) {
      const pattern = type === 'success' ? [100, 50, 100] : (type === 'warning' ? [100, 50, 100, 50, 100] : [200, 50, 200]);
      window.navigator.vibrate(pattern);
    }
  }
};
class MetronomeManager {
  private audioContext: AudioContext | null = null;
  private timer: number | null = null;
  private isPlaying = false;
  private bpm = 110;

  private setupAudioContext() {
    if (!this.audioContext) {
      try {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      } catch (e) {
        console.error("Web Audio API is not supported in this browser");
      }
    }
  }

  private playBeep() {
    if (!this.audioContext) return;

    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, this.audioContext.currentTime);

    gainNode.gain.setValueAtTime(0.5, this.audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 0.1);

    oscillator.connect(gainNode);
    gainNode.connect(this.audioContext.destination);

    oscillator.start(this.audioContext.currentTime);
    oscillator.stop(this.audioContext.currentTime + 0.1);
  }

  setBPM(newBpm: number) {
    this.bpm = newBpm;
    if (this.isPlaying) {
      this.stop();
      this.start();
    }
  }

  start() {
    if (this.isPlaying) return;
    this.setupAudioContext();
    if (!this.audioContext) return;
    if (this.audioContext.state === 'suspended') this.audioContext.resume();

    const interval = 60000 / this.bpm;
    this.timer = window.setInterval(() => this.playBeep(), interval);
    this.isPlaying = true;
    this.playBeep();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.isPlaying = false;
  }

  toggle(bpm: number): boolean {
    if (this.isPlaying) { this.stop(); return false; }
    else { this.setBPM(bpm); this.start(); return true; }
  }
}
const metronome = new MetronomeManager();

//============================================================================
// DOSAGE CALCULATOR
//============================================================================
enum PatientAgeCategory {
  Adult = "≥12 years / Adult", ElevenYears = "11 years", TenYears = "10 years",
  NineYears = "9 years", EightYears = "8 years", SevenYears = "7 years",
  SixYears = "6 years", FiveYears = "5 years", FourYears = "4 years",
  ThreeYears = "3 years", TwoYears = "2 years", EighteenMonths = "18 months",
  TwelveMonths = "12 months", NineMonths = "9 months", SixMonths = "6 months",
  ThreeMonths = "3 months", OneMonth = "1 month", PostBirthToOneMonth = "Post-birth to 1 month",
  AtBirth = "At birth"
}
const PatientAgeCategoryList = Object.values(PatientAgeCategory);
const DosageCalculator = {
  calculateAdrenalineDose: (age: PatientAgeCategory): string => {
    switch (age) {
      case PatientAgeCategory.Adult: return "1mg";
      case PatientAgeCategory.ElevenYears: return "350mcg"; case PatientAgeCategory.TenYears: return "320mcg";
      case PatientAgeCategory.NineYears: return "300mcg"; case PatientAgeCategory.EightYears: return "260mcg";
      case PatientAgeCategory.SevenYears: return "230mcg"; case PatientAgeCategory.SixYears: return "210mcg";
      case PatientAgeCategory.FiveYears: return "190mcg"; case PatientAgeCategory.FourYears: return "160mcg";
      case PatientAgeCategory.ThreeYears: return "140mcg"; case PatientAgeCategory.TwoYears: return "120mcg";
      case PatientAgeCategory.EighteenMonths: return "110mcg"; case PatientAgeCategory.TwelveMonths: return "100mcg";
      case PatientAgeCategory.NineMonths: return "90mcg"; case PatientAgeCategory.SixMonths: return "80mcg";
      case PatientAgeCategory.ThreeMonths: return "60mcg"; case PatientAgeCategory.OneMonth: return "50mcg";
      case PatientAgeCategory.PostBirthToOneMonth: return "50mcg"; case PatientAgeCategory.AtBirth: return "70mcg";
      default: return "N/A";
    }
  },
  calculateAmiodaroneDose: (age: PatientAgeCategory, doseNumber: number): string | null => {
    switch (age) {
      case PatientAgeCategory.Adult: return doseNumber === 1 ? "300mg" : "150mg";
      case PatientAgeCategory.ElevenYears: return "180mg"; case PatientAgeCategory.TenYears: return "160mg";
      case PatientAgeCategory.NineYears: return "150mg"; case PatientAgeCategory.EightYears: return "130mg";
      case PatientAgeCategory.SevenYears: return "120mg"; case PatientAgeCategory.SixYears: return "100mg";
      case PatientAgeCategory.FiveYears: return "100mg"; case PatientAgeCategory.FourYears: return "80mg";
      case PatientAgeCategory.ThreeYears: return "70mg"; case PatientAgeCategory.TwoYears: return "60mg";
      case PatientAgeCategory.EighteenMonths: return "55mg"; case PatientAgeCategory.TwelveMonths: return "50mg";
      case PatientAgeCategory.NineMonths: return "45mg"; case PatientAgeCategory.SixMonths: return "40mg";
      case PatientAgeCategory.ThreeMonths: return "30mg"; case PatientAgeCategory.OneMonth: return "25mg";
      case PatientAgeCategory.PostBirthToOneMonth: case PatientAgeCategory.AtBirth: return null;
      default: return null;
    }
  }
};

//============================================================================
// FIREBASE CONTEXT (Modified for Device ID)
//============================================================================

type FirebaseContextType = {
  db: Firestore | null;
  deviceId: string | null;
  isFirebaseReady: boolean;
};

const FirebaseContext = createContext<FirebaseContextType>({
  db: null,
  deviceId: null,
  isFirebaseReady: false,
});

const FirebaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseState, setFirebaseState] = useState<FirebaseContextType>({
    db: null,
    deviceId: null,
    isFirebaseReady: false,
  });

  useEffect(() => {
    const currentDeviceId = getDeviceId();
    if (Object.keys(firebaseConfig).length === 0) {
      console.warn("Firebase config is empty. App will run in-memory.");
      setFirebaseState({ db: null, deviceId: currentDeviceId, isFirebaseReady: true });
      return;
    }
    try {
      const app = initializeApp(firebaseConfig);
      const dbInstance = getFirestore(app);
      setLogLevel('debug');
      db = dbInstance;
      setFirebaseState({ db: dbInstance, deviceId: currentDeviceId, isFirebaseReady: true });
      console.log("Firebase Firestore initialized and ready.");
    } catch (e) {
      console.error("Firebase initialization error:", e);
      setFirebaseState({ db: null, deviceId: currentDeviceId, isFirebaseReady: true });
    }
  }, []);

  return (
    <FirebaseContext.Provider value={firebaseState}>
      {children}
    </FirebaseContext.Provider>
  );
};

const useFirebase = () => useContext(FirebaseContext);

//============================================================================
// CORE LOGIC: ArrestViewModel (Modified for Device ID)
//============================================================================

type UndoState = {
  arrestState: ArrestState; masterTime: number; cprTime: number; timeOffset: number; events: EventLog[];
  shockCount: number; adrenalineCount: number; amiodaroneCount: number; lidocaineCount: number;
  lastAdrenalineTime: number | null; antiarrhythmicGiven: AntiarrhythmicDrug; shockCountForAmiodarone1: number | null;
  airwayPlaced: boolean; reversibleCauses: ChecklistItem[]; postROSCTasks: ChecklistItem[]; postMortemTasks: ChecklistItem[];
  startTime: number | null; uiState: UIState; patientAgeCategory: PatientAgeCategory | null; cprCycleStartTime: number;
};

const useArrestViewModel = () => {
  const { db, deviceId, isFirebaseReady } = useFirebase();
  const { cprCycleDuration, adrenalineInterval, showDosagePrompts } = useSettings();

  const [arrestState, setArrestState] = useState<ArrestState>(ArrestState.Pending);
  const [masterTime, setMasterTime] = useState(0);
  const [cprTime, setCprTime] = useState(cprCycleDuration);
  const [timeOffset, setTimeOffset] = useState(0);
  const [uiState, setUiState] = useState<UIState>(UIState.Default);
  const [events, setEvents] = useState<EventLog[]>([]);
  const [shockCount, setShockCount] = useState(0);
  const [adrenalineCount, setAdrenalineCount] = useState(0);
  const [amiodaroneCount, setAmiodaroneCount] = useState(0);
  const [lidocaineCount, setLidocaineCount] = useState(0);
  const [airwayPlaced, setAirwayPlaced] = useState(false);
  const [antiarrhythmicGiven, setAntiarrhythmicGiven] = useState<AntiarrhythmicDrug>(AntiarrhythmicDrug.None);
  const [reversibleCauses, setReversibleCauses] = useState<ChecklistItem[]>(AppConstants.reversibleCausesTemplate);
  const [postROSCTasks, setPostROSCTasks] = useState<ChecklistItem[]>(AppConstants.postROSCTasksTemplate);
  const [postMortemTasks, setPostMortemTasks] = useState<ChecklistItem[]>(AppConstants.postMortemTasksTemplate);
  const [patientAgeCategory, setPatientAgeCategory] = useState<PatientAgeCategory | null>(null);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [cprCycleStartTime, setCprCycleStartTime] = useState(0);
  const [lastAdrenalineTime, setLastAdrenalineTime] = useState<number | null>(null);
  const [shockCountForAmiodarone1, setShockCountForAmiodarone1] = useState<number | null>(null);
  const [undoHistory, setUndoHistory] = useState<UndoState[]>([]);
  const timerRef = useRef<number | null>(null);

  const totalArrestTime = masterTime + timeOffset;
  const canUndo = undoHistory.length > 0;
  const hypothermiaStatus = useMemo(() => reversibleCauses.find(c => c.id === 'hypothermia')?.hypothermiaStatus || HypothermiaStatus.None, [reversibleCauses]);
  const isAdrenalineAvailable = hypothermiaStatus !== HypothermiaStatus.Severe;
  const isAmiodaroneAvailable = ((shockCount >= 3 && amiodaroneCount === 0) || (shockCount >= 5 && amiodaroneCount === 1)) && antiarrhythmicGiven !== AntiarrhythmicDrug.Lidocaine && isAdrenalineAvailable;
  const isLidocaineAvailable = ((shockCount >= 3 && lidocaineCount === 0) || (shockCount >= 5 && lidocaineCount === 1)) && antiarrhythmicGiven !== AntiarrhythmicDrug.Amiodarone;
  const timeUntilAdrenaline = useMemo(() => {
    if (lastAdrenalineTime === null) return null;
    const interval = hypothermiaStatus === HypothermiaStatus.Moderate ? adrenalineInterval * 2 : adrenalineInterval;
    const timeSince = totalArrestTime - lastAdrenalineTime;
    return interval - timeSince;
  }, [totalArrestTime, lastAdrenalineTime, adrenalineInterval, hypothermiaStatus]);
  const shouldShowAmiodaroneReminder = amiodaroneCount === 1 && shockCountForAmiodarone1 !== null && shockCount >= shockCountForAmiodarone1 + 2;
  const shouldShowAmiodaroneFirstDosePrompt = isAmiodaroneAvailable && amiodaroneCount === 0;
  const shouldShowAdrenalinePrompt = shockCount >= 3 && adrenalineCount === 0 && isAdrenalineAvailable;

  const stopTimer = () => { if (timerRef.current) clearInterval(timerRef.current); timerRef.current = null; };
  const tick = () => {
    if (!startTime) return;
    setMasterTime(prevMasterTime => {
      const newMasterTime = Math.floor((Date.now() - startTime) / 1000);
      const newTotalArrestTime = newMasterTime + timeOffset;
      if (arrestState === ArrestState.Active && uiState === UIState.Default) {
        setCprCycleStartTime(prevCprCycleStartTime => {
          let newCprTime = cprCycleDuration - (newTotalArrestTime - prevCprCycleStartTime);
          if (newCprTime <= 10 && newCprTime > 0) HapticManager.impact('light');
          if (newCprTime < -0.9) {
            HapticManager.notification('warning');
            logEvent("CPR Cycle Complete", EventType.Cpr, newTotalArrestTime);
            setCprTime(cprCycleDuration); return newTotalArrestTime;
          } else { setCprTime(newCprTime); return prevCprCycleStartTime; }
        });
      }
      return newMasterTime;
    });
  };
  const startTimer = () => { stopTimer(); timerRef.current = window.setInterval(tick, 1000); };
  useEffect(() => {
    if ((arrestState === ArrestState.Active || arrestState === ArrestState.Rosc) && !timerRef.current) startTimer();
    else if ((arrestState === ArrestState.Pending || arrestState === ArrestState.Ended) && timerRef.current) stopTimer();
    return () => stopTimer();
  }, [arrestState]);
  useEffect(() => {
    if (arrestState === ArrestState.Active && uiState === UIState.Default) { const timeElapsedInCycle = cprCycleDuration - cprTime; setCprTime(cprCycleDuration - timeElapsedInCycle); }
    else if (arrestState === ArrestState.Pending) { setCprTime(cprCycleDuration); }
  }, [cprCycleDuration]);

  const logDocumentId = "arrest_log";
  const getLogDocRef = () => db && deviceId ? doc(db, 'artifacts', appId, 'users', deviceId, 'arrestLogs', logDocumentId) : null;

  const saveStateToDb = (newState: Partial<ArrestDocument>) => {
    if (!db || !deviceId) { console.warn("No DB or Device ID. Skipping save."); return; }
    const docRef = getLogDocRef();
    if (docRef) {
       const currentFullState: ArrestDocument = { startTime, totalDuration: totalArrestTime, finalOutcome: arrestState === ArrestState.Rosc ? "ROSC" : arrestState === ArrestState.Ended ? "Deceased" : "Incomplete", events, arrestState, masterTime, cprTime, timeOffset, uiState, shockCount, adrenalineCount, amiodaroneCount, lidocaineCount, airwayPlaced, antiarrhythmicGiven, lastAdrenalineTime, shockCountForAmiodarone1, reversibleCauses, postROSCTasks, postMortemTasks, patientAgeCategory, cprCycleStartTime };
       const docData = { ...currentFullState, ...newState };
       setDoc(docRef, docData, { merge: true }).catch(e => console.error("Error saving state:", e));
    }
  };

  const saveUndoState = () => { const currentState: UndoState = { arrestState, masterTime, cprTime, timeOffset, events, shockCount, adrenalineCount, amiodaroneCount, lidocaineCount, lastAdrenalineTime, antiarrhythmicGiven, shockCountForAmiodarone1, airwayPlaced, reversibleCauses, postROSCTasks, postMortemTasks, startTime, uiState, patientAgeCategory, cprCycleStartTime }; setUndoHistory(prev => [...prev, currentState]); };
  const logEvent = (message: string, type: EventType, logTime: number = totalArrestTime) => { const newEvent: EventLog = { id: crypto.randomUUID(), timestamp: logTime, message, type }; setEvents(prevEvents => { const updatedEvents = [newEvent, ...prevEvents]; saveStateToDb({ events: updatedEvents }); return updatedEvents; }); HapticManager.impact(); };

  const startArrest = () => { saveUndoState(); const now = Date.now(); const realStartTime = now - (timeOffset * 1000); setStartTime(realStartTime); setArrestState(ArrestState.Active); const initialCycleStartTime = timeOffset; setCprCycleStartTime(initialCycleStartTime); setCprTime(cprCycleDuration); logEvent(`Arrest Started at ${new Date(now).toLocaleTimeString()}`, EventType.Status, timeOffset); saveStateToDb({ startTime: realStartTime, arrestState: ArrestState.Active, cprCycleStartTime: initialCycleStartTime }); };
  const analyseRhythm = () => { saveUndoState(); setUiState(UIState.Analyzing); logEvent("Rhythm analysis. Pausing CPR.", EventType.Analysis); saveStateToDb({ uiState: UIState.Analyzing }); };
  const logRhythm = (rhythm: string, isShockable: boolean) => { saveUndoState(); logEvent(`Rhythm is ${rhythm}`, EventType.Rhythm); if (isShockable) { setUiState(UIState.ShockAdvised); saveStateToDb({ uiState: UIState.ShockAdvised }); } else { resumeCPR(); } };
  const deliverShock = () => { saveUndoState(); const newShockCount = shockCount + 1; setShockCount(newShockCount); logEvent(`Shock ${newShockCount} Delivered`, EventType.Shock); resumeCPR(); };
  const resumeCPR = () => { setUiState(UIState.Default); const newCycleStartTime = totalArrestTime; setCprCycleStartTime(newCycleStartTime); setCprTime(cprCycleDuration); logEvent("Resuming CPR.", EventType.Cpr); saveStateToDb({ uiState: UIState.Default, cprCycleStartTime: newCycleStartTime }); };
  const logAdrenaline = (dosage?: string) => { saveUndoState(); const newAdrenalineCount = adrenalineCount + 1; setAdrenalineCount(newAdrenalineCount); const newLastAdrenalineTime = totalArrestTime; setLastAdrenalineTime(newLastAdrenalineTime); const dosageText = (showDosagePrompts && dosage) ? ` (${dosage})` : ""; logEvent(`Adrenaline${dosageText} Given - Dose ${newAdrenalineCount}`, EventType.Drug); saveStateToDb({ adrenalineCount: newAdrenalineCount, lastAdrenalineTime: newLastAdrenalineTime }); };
  const logAmiodarone = (dosage?: string) => { saveUndoState(); const newAmiodaroneCount = amiodaroneCount + 1; setAmiodaroneCount(newAmiodaroneCount); setAntiarrhythmicGiven(AntiarrhythmicDrug.Amiodarone); let newShockCountForAmiodarone1 = shockCountForAmiodarone1; if (newAmiodaroneCount === 1) { newShockCountForAmiodarone1 = shockCount; setShockCountForAmiodarone1(newShockCountForAmiodarone1); } const dosageText = (showDosagePrompts && dosage) ? ` (${dosage})` : ""; logEvent(`Amiodarone${dosageText} Given - Dose ${newAmiodaroneCount}`, EventType.Drug); saveStateToDb({ amiodaroneCount: newAmiodaroneCount, antiarrhythmicGiven: AntiarrhythmicDrug.Amiodarone, shockCountForAmiodarone1: newShockCountForAmiodarone1 }); };
  const logLidocaine = (dosage?: string) => { saveUndoState(); const newLidocaineCount = lidocaineCount + 1; setLidocaineCount(newLidocaineCount); setAntiarrhythmicGiven(AntiarrhythmicDrug.Lidocaine); const dosageText = (showDosagePrompts && dosage) ? ` (${dosage})` : ""; logEvent(`Lidocaine${dosageText} Given - Dose ${newLidocaineCount}`, EventType.Drug); saveStateToDb({ lidocaineCount: newLidocaineCount, antiarrhythmicGiven: AntiarrhythmicDrug.Lidocaine }); };
  const logOtherDrug = (drug: string, dosage?: string) => { saveUndoState(); const dosageText = (showDosagePrompts && dosage) ? ` (${dosage})` : ""; logEvent(`${drug}${dosageText} Given`, EventType.Drug); };
  const logAirwayPlaced = () => { saveUndoState(); setAirwayPlaced(true); logEvent("Advanced Airway Placed", EventType.Airway); saveStateToDb({ airwayPlaced: true }); };
  const logEtco2 = (value: string) => { saveUndoState(); if (Number(value) > 0) logEvent(`ETCO2: ${value} mmHg`, EventType.Etco2); };
  const achieveROSC = () => { saveUndoState(); setArrestState(ArrestState.Rosc); setUiState(UIState.Default); logEvent("Return of Spontaneous Circulation (ROSC)", EventType.Status); saveStateToDb({ arrestState: ArrestState.Rosc, uiState: UIState.Default }); };
  const endArrest = () => { saveUndoState(); setArrestState(ArrestState.Ended); stopTimer(); logEvent("Arrest Ended (Patient Deceased)", EventType.Status); saveStateToDb({ arrestState: ArrestState.Ended }); };
  const reArrest = () => { saveUndoState(); setArrestState(ArrestState.Active); const newCycleStartTime = totalArrestTime; setCprCycleStartTime(newCycleStartTime); setCprTime(cprCycleDuration); logEvent("Patient Re-Arrested. CPR Resumed.", EventType.Status); saveStateToDb({ arrestState: ArrestState.Active, cprCycleStartTime: newCycleStartTime }); };
  const addTimeOffset = (seconds: number) => { saveUndoState(); const newTimeOffset = timeOffset + seconds; setTimeOffset(newTimeOffset); logEvent(`Time offset added: +${seconds / 60} min`, EventType.Status, totalArrestTime); saveStateToDb({ timeOffset: newTimeOffset }); };
  const toggleChecklistItemCompletion = (item: ChecklistItem) => { saveUndoState(); const updatedItems = reversibleCauses.map(c => c.id === item.id ? { ...c, isCompleted: !c.isCompleted } : c); setReversibleCauses(updatedItems); const status = !item.isCompleted ? "checked" : "unchecked"; logEvent(`${item.name} ${status}`, EventType.Cause); saveStateToDb({ reversibleCauses: updatedItems }); };
  const setHypothermiaStatus = (status: HypothermiaStatus) => { saveUndoState(); const updatedItems = reversibleCauses.map(c => c.id === 'hypothermia' ? { ...c, isCompleted: (status !== HypothermiaStatus.None), hypothermiaStatus: status } : c); setReversibleCauses(updatedItems); logEvent(`Hypothermia status set to: ${status}`, EventType.Cause); saveStateToDb({ reversibleCauses: updatedItems }); };
  const togglePostROSCTask = (item: ChecklistItem) => { saveUndoState(); const updatedTasks = postROSCTasks.map(t => t.id === item.id ? { ...t, isCompleted: !t.isCompleted } : t); setPostROSCTasks(updatedTasks); const status = !item.isCompleted ? "checked" : "unchecked"; logEvent(`Post-ROSC task: ${item.name} ${status}`, EventType.Status); saveStateToDb({ postROSCTasks: updatedTasks }); };
  const togglePostMortemTask = (item: ChecklistItem) => { saveUndoState(); const updatedTasks = postMortemTasks.map(t => t.id === item.id ? { ...t, isCompleted: !t.isCompleted } : t); setPostMortemTasks(updatedTasks); const status = !item.isCompleted ? "checked" : "unchecked"; logEvent(`Post-mortem task: ${item.name} ${status}`, EventType.Status); saveStateToDb({ postMortemTasks: updatedTasks }); };
  const undo = () => { const lastState = undoHistory.at(-1); if (lastState) { setUndoHistory(prev => prev.slice(0, -1)); setArrestState(lastState.arrestState); setMasterTime(lastState.masterTime); setCprTime(lastState.cprTime); setTimeOffset(lastState.timeOffset); setEvents(lastState.events); setShockCount(lastState.shockCount); setAdrenalineCount(lastState.adrenalineCount); setAmiodaroneCount(lastState.amiodaroneCount); setLidocaineCount(lastState.lidocaineCount); setLastAdrenalineTime(lastState.lastAdrenalineTime); setAntiarrhythmicGiven(lastState.antiarrhythmicGiven); setShockCountForAmiodarone1(lastState.shockCountForAmiodarone1); setAirwayPlaced(lastState.airwayPlaced); setReversibleCauses(lastState.reversibleCauses); setPostROSCTasks(lastState.postROSCTasks); setPostMortemTasks(lastState.postMortemTasks); setStartTime(lastState.startTime); setUiState(lastState.uiState); setPatientAgeCategory(lastState.patientAgeCategory); setCprCycleStartTime(lastState.cprCycleStartTime); saveStateToDb(lastState); } };
  const performReset = async (shouldSaveLog: boolean, shouldCopy: boolean) => { if (shouldCopy) copySummaryToClipboard(); if (shouldSaveLog && startTime !== null && db && deviceId) { const docRef = getLogDocRef(); if (docRef) { try { const logDataSnap = await getDoc(docRef); if (logDataSnap.exists()) { const logData = logDataSnap.data(); logData.events = events; logData.totalDuration = totalArrestTime; logData.finalOutcome = arrestState === ArrestState.Rosc ? "ROSC" : arrestState === ArrestState.Ended ? "Deceased" : "Incomplete"; const archiveCollectionRef = collection(db, 'artifacts', appId, 'users', deviceId, 'arrestLogsArchive'); await addDoc(archiveCollectionRef, logData); await deleteDoc(docRef); console.log("Log archived and current log deleted."); } else { console.log("No current log data to archive."); await deleteDoc(docRef).catch((e: Error) => console.error("Error deleting (empty?) log:", e)); } } catch (e) { console.error("Error archiving log:", e); } } } else if (db && deviceId) { const docRef = getLogDocRef(); if (docRef) await deleteDoc(docRef).catch(e => console.error("Error deleting log:", e)); console.log("Current log deleted without archiving."); } stopTimer(); setArrestState(ArrestState.Pending); setMasterTime(0); setCprTime(cprCycleDuration); setTimeOffset(0); setUiState(UIState.Default); setEvents([]); setShockCount(0); setAdrenalineCount(0); setAmiodaroneCount(0); setLidocaineCount(0); setAirwayPlaced(false); setAntiarrhythmicGiven(AntiarrhythmicDrug.None); setLastAdrenalineTime(null); setShockCountForAmiodarone1(null); setStartTime(null); setUndoHistory([]); setPatientAgeCategory(null); setReversibleCauses(AppConstants.reversibleCausesTemplate); setPostROSCTasks(AppConstants.postROSCTasksTemplate); setPostMortemTasks(AppConstants.postMortemTasksTemplate); setCprCycleStartTime(0); };
  const copySummaryToClipboard = () => { const summaryText = `\neResus Event Summary\nTotal Arrest Time: ${TimeFormatter.format(totalArrestTime)}\n\n--- Event Log ---\n${[...events].reverse().map(e => `[${TimeFormatter.format(e.timestamp)}] ${e.message}`).join("\n")}\n    `; const textArea = document.createElement("textarea"); textArea.value = summaryText.trim(); textArea.style.position = "fixed"; textArea.style.left = "-9999px"; document.body.appendChild(textArea); textArea.focus(); textArea.select(); try { document.execCommand('copy'); HapticManager.notification('success'); } catch (err) { console.error('Failed to copy text: ', err); HapticManager.notification('error'); } document.body.removeChild(textArea); };

  useEffect(() => {
    if (!isFirebaseReady || !db || !deviceId) { console.log("Firebase not ready or no device ID for data loading yet."); return; }
    console.log(`Firebase is ready. Device ID: ${deviceId}. Attaching snapshot listener.`);
    const docRef = getLogDocRef();
    if (!docRef) { console.error("Could not get Firestore document reference."); return; }
    const unsubscribe = onSnapshot(docRef, (doc) => { console.log("Firestore snapshot received."); if (doc.exists()) { const data = doc.data() as ArrestDocument; console.log("Loaded data from Firestore:", data); if (arrestState === ArrestState.Pending && startTime === null && data.startTime) { console.log("Restoring state from Firestore."); setArrestState(data.arrestState || ArrestState.Pending); setMasterTime(data.masterTime || 0); setCprTime(data.cprTime || cprCycleDuration); setTimeOffset(data.timeOffset || 0); setEvents(data.events || []); setShockCount(data.shockCount || 0); setAdrenalineCount(data.adrenalineCount || 0); setAmiodaroneCount(data.amiodaroneCount || 0); setLidocaineCount(data.lidocaineCount || 0); setLastAdrenalineTime(data.lastAdrenalineTime || null); setAntiarrhythmicGiven(data.antiarrhythmicGiven || AntiarrhythmicDrug.None); setShockCountForAmiodarone1(data.shockCountForAmiodarone1 || null); setAirwayPlaced(data.airwayPlaced || false); setReversibleCauses(Array.isArray(data.reversibleCauses) ? data.reversibleCauses : AppConstants.reversibleCausesTemplate); setPostROSCTasks(Array.isArray(data.postROSCTasks) ? data.postROSCTasks : AppConstants.postROSCTasksTemplate); setPostMortemTasks(Array.isArray(data.postMortemTasks) ? data.postMortemTasks : AppConstants.postMortemTasksTemplate); setStartTime(data.startTime || null); setUiState(data.uiState || UIState.Default); setPatientAgeCategory(data.patientAgeCategory || null); setCprCycleStartTime(data.cprCycleStartTime || 0); } else { console.log("Local state is not pending/fresh or no startTime in Firestore data, skipping restore."); } } else { console.log("No existing log found in Firestore. Ensuring local state is reset."); if (arrestState !== ArrestState.Pending || startTime !== null) { console.warn("Firestore doc deleted, local state might be out of sync until next reset/action.") } } }, (error) => { console.error("Firestore snapshot error:", error); });
    return () => { console.log("Detaching Firestore snapshot listener."); unsubscribe(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFirebaseReady, db, deviceId]);

  return { arrestState, masterTime, cprTime, timeOffset, uiState, events, shockCount, adrenalineCount, amiodaroneCount, lidocaineCount, airwayPlaced, antiarrhythmicGiven, reversibleCauses, postROSCTasks, postMortemTasks, patientAgeCategory, totalArrestTime, canUndo, isAdrenalineAvailable, isAmiodaroneAvailable, isLidocaineAvailable, timeUntilAdrenaline, shouldShowAmiodaroneReminder, shouldShowAmiodaroneFirstDosePrompt, shouldShowAdrenalinePrompt, startArrest, analyseRhythm, logRhythm, deliverShock, logAdrenaline, logAmiodarone, logLidocaine, logOtherDrug, setPatientAgeCategory, logAirwayPlaced, logEtco2, achieveROSC, endArrest, reArrest, addTimeOffset, toggleChecklistItemCompletion, setHypothermiaStatus, togglePostROSCTask, togglePostMortemTask, undo, performReset, copySummaryToClipboard };
};

type ArrestContextType = ReturnType<typeof useArrestViewModel> | null;
const ArrestContext = createContext<ArrestContextType>(null);
const useArrest = () => { const context = useContext(ArrestContext); if (!context) { throw new Error("useArrest must be used within an ArrestProvider"); } return context; };

//============================================================================
// MODAL COMPONENTS
//============================================================================

// Define Props type explicitly for Modal
type ModalProps = {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
};

const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md m-4 border border-gray-200 dark:border-gray-700" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"><X size={24} /></button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
};

const SummaryModal: React.FC = () => {
  const { events, totalArrestTime, copySummaryToClipboard } = useArrest();
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  const sortedEvents = useMemo(() => [...events].reverse(), [events]);
  const handleCopy = () => { copySummaryToClipboard(); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  return (
    <>
      <button onClick={() => setShow(true)} className="flex-1 px-4 py-3 bg-gray-600 text-white rounded-lg font-semibold text-sm shadow-md hover:bg-gray-700 transition duration-150"><Clipboard size={16} className="inline-block mr-2" /> Summary</button>
      <Modal isOpen={show} onClose={() => setShow(false)} title="Event Summary">
        <div className="space-y-4">
          <div className="text-sm font-medium text-gray-700 dark:text-gray-300">Total Arrest Time: <span className="font-bold text-gray-900 dark:text-white">{TimeFormatter.format(totalArrestTime)}</span></div>
          <div className="h-64 overflow-y-auto p-3 bg-gray-100 dark:bg-gray-900 rounded-md border border-gray-200 dark:border-gray-700">
            {sortedEvents.length === 0 ? <p className="text-gray-500 italic text-center py-4">No events logged yet.</p> : sortedEvents.map(event => ( <div key={event.id} className="flex font-mono text-xs mb-1"><span className="font-bold text-blue-600 dark:text-blue-400 mr-2">[{TimeFormatter.format(event.timestamp)}]</span><span className="text-gray-700 dark:text-gray-300 break-words">{event.message}</span></div> ))}
          </div>
          <ActionButton title={copied ? "Copied!" : "Copy to Clipboard"} backgroundColor="bg-blue-600" foregroundColor="text-white" onClick={handleCopy} height="h-12" />
        </div>
      </Modal>
    </>
  );
};

const ResetModal: React.FC = () => {
  const { performReset } = useArrest();
  const [show, setShow] = useState(false);
  const handleReset = (save: boolean, copy: boolean) => { performReset(save, copy); setShow(false); };

  return (
    <>
      <button onClick={() => setShow(true)} className="flex-1 px-4 py-3 bg-red-600 text-white rounded-lg font-semibold text-sm shadow-md hover:bg-red-700 transition duration-150"><RotateCw size={16} className="inline-block mr-2" /> Reset</button>
      <Modal isOpen={show} onClose={() => setShow(false)} title="Reset Arrest Log?">
        <div className="space-y-4 text-center">
          <AlertTriangle size={48} className="mx-auto text-red-500" />
          <p className="text-gray-700 dark:text-gray-300">This will archive the current log (if started) and start a new one. This action cannot be undone.</p>
          <div className="space-y-3">
            <ActionButton title="Copy, Archive & Reset" backgroundColor="bg-blue-600" foregroundColor="text-white" onClick={() => handleReset(true, true)} height="h-12" />
            <ActionButton title="Archive & Reset" backgroundColor="bg-red-600" foregroundColor="text-white" onClick={() => handleReset(true, false)} height="h-12" />
            <ActionButton title="Delete & Reset" backgroundColor="bg-gray-200 dark:bg-gray-600" foregroundColor="text-red-600 dark:text-red-400" onClick={() => handleReset(false, false)} height="h-12" />
          </div>
        </div>
      </Modal>
    </>
  );
};

// Define Props for HypothermiaModal
type HypothermiaModalProps = {
    isOpen: boolean;
    onClose: () => void;
};
const HypothermiaModal: React.FC<HypothermiaModalProps> = ({ isOpen, onClose }) => {
  const { setHypothermiaStatus } = useArrest();
  const handleConfirm = (status: HypothermiaStatus) => { setHypothermiaStatus(status); onClose(); };
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Set Hypothermia Status">
      <div className="space-y-3">
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">Select the patient's temperature range to apply the correct guidelines.</p>
        <ActionButton title="Severe (< 30°C)" backgroundColor="bg-blue-600" foregroundColor="text-white" onClick={() => handleConfirm(HypothermiaStatus.Severe)} height="h-12" />
        <ActionButton title="Moderate (30-35°C)" backgroundColor="bg-yellow-500" foregroundColor="text-white" onClick={() => handleConfirm(HypothermiaStatus.Moderate)} height="h-12" />
        <ActionButton title="Clear / Normothermic" backgroundColor="bg-gray-200 dark:bg-gray-600" foregroundColor="text-gray-800 dark:text-gray-200" onClick={() => handleConfirm(HypothermiaStatus.Normothermic)} height="h-12" />
      </div>
    </Modal>
  );
};

// Define Props for OtherDrugsModal
type OtherDrugsModalProps = {
    isOpen: boolean;
    onClose: () => void;
};
const OtherDrugsModal: React.FC<OtherDrugsModalProps> = ({ isOpen, onClose }) => {
  const { logOtherDrug } = useArrest();
  const { showDosagePrompts } = useSettings();
  const handleSelect = (drug: string) => { if (showDosagePrompts) { console.log("Dosage prompt needed for", drug); logOtherDrug(drug, "manual dose required"); } else { logOtherDrug(drug); } onClose(); };
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Log Other Medication">
      <div className="h-64 overflow-y-auto space-y-2">
        {AppConstants.otherDrugs.map(drug => ( <button key={drug} onClick={() => handleSelect(drug)} className="w-full text-left px-4 py-3 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200">{drug}</button> ))}
      </div>
    </Modal>
  );
};

// Define Props for Etco2Modal
type Etco2ModalProps = {
    isOpen: boolean;
    onClose: () => void;
};
const Etco2Modal: React.FC<Etco2ModalProps> = ({ isOpen, onClose }) => {
  const { logEtco2 } = useArrest();
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (isOpen) setTimeout(() => inputRef.current?.focus(), 100); }, [isOpen]);
  const handleConfirm = () => { if (value) { logEtco2(value); setValue(""); onClose(); } };
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Log ETCO2 Value">
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">Enter the current end-tidal CO2 reading in mmHg.</p>
        <input ref={inputRef} type="number" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleConfirm()} className="w-full px-4 py-3 text-lg text-center bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="e.g., 35" />
        <ActionButton title="Log Value" backgroundColor="bg-blue-600" foregroundColor="text-white" onClick={handleConfirm} disabled={!value} height="h-12" />
      </div>
    </Modal>
  );
};

// Define Props for DosageEntryModal
type DosageEntryModalProps = {
    drug: DrugToLog | null;
    onClose: () => void;
};
const DosageEntryModal: React.FC<DosageEntryModalProps> = ({ drug, onClose }) => {
  const { logAdrenaline, logAmiodarone, logLidocaine, logOtherDrug, amiodaroneCount, setPatientAgeCategory } = useArrest();
  const [age, setAge] = useState<PatientAgeCategory>(PatientAgeCategory.Adult);
  const [manualAmount, setManualAmount] = useState("");
  const [manualUnit, setManualUnit] = useState("mg");
  const calculatedDose = useMemo(() => { if (!drug) return null; switch(drug.type) { case DrugToLogType.Adrenaline: return DosageCalculator.calculateAdrenalineDose(age); case DrugToLogType.Amiodarone: return DosageCalculator.calculateAmiodaroneDose(age, amiodaroneCount + 1); default: return null; } }, [drug, age, amiodaroneCount]);
  const handleConfirm = (dosage: string, ageCategory: PatientAgeCategory | null) => { if (!drug) return; if (ageCategory) setPatientAgeCategory(ageCategory); switch (drug.type) { case DrugToLogType.Adrenaline: logAdrenaline(dosage); break; case DrugToLogType.Amiodarone: logAmiodarone(dosage); break; case DrugToLogType.Lidocaine: logLidocaine(dosage); break; case DrugToLogType.Other: logOtherDrug(drug.title, dosage); break; } onClose(); };
  const resetForm = () => { setAge(PatientAgeCategory.Adult); setManualAmount(""); setManualUnit("mg"); };
  const handleClose = () => { resetForm(); onClose(); };

  const renderContent = () => {
    if (!drug) return null;
    if (drug.type === DrugToLogType.Lidocaine || drug.type === DrugToLogType.Other) {
      return ( <div className="space-y-4"> <p className="text-sm text-gray-600 dark:text-gray-400">Enter manual dose for {drug.title}.</p> <div className="flex space-x-2"> <input type="number" value={manualAmount} onChange={(e) => setManualAmount(e.target.value)} className="flex-grow px-4 py-3 bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Amount" /> <select value={manualUnit} onChange={(e) => setManualUnit(e.target.value)} className="px-4 py-3 bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"> <option>mg</option><option>mcg</option><option>g</option><option>ml</option> </select> </div> <ActionButton title={`Log ${manualAmount}${manualUnit}`} backgroundColor="bg-blue-600" foregroundColor="text-white" onClick={() => handleConfirm(`${manualAmount}${manualUnit}`, null)} disabled={!manualAmount} height="h-12" /> </div> );
    }
    return ( <div className="space-y-4"> <div className="space-y-2"> <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Patient Age</label> <select value={age} onChange={(e) => setAge(e.target.value as PatientAgeCategory)} className="w-full px-4 py-3 bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"> {PatientAgeCategoryList.map(cat => <option key={cat} value={cat}>{cat}</option>)} </select> </div> <div className="space-y-3 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg"> <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Calculated Dose</label> {calculatedDose ? ( <> <p className="text-2xl font-bold text-center text-gray-900 dark:text-white">{calculatedDose}</p> <ActionButton title={`Log ${calculatedDose}`} backgroundColor="bg-blue-600" foregroundColor="text-white" onClick={() => handleConfirm(calculatedDose, age)} height="h-12" /> </> ) : ( <p className="text-center text-gray-500 italic">N/A for this age group.</p> )} </div> <div className="space-y-3 pt-4 border-t border-gray-200 dark:border-gray-700"> <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Manual Override</label> <div className="flex space-x-2"> <input type="number" value={manualAmount} onChange={(e) => setManualAmount(e.target.value)} className="flex-grow px-4 py-3 bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Amount" /> <select value={manualUnit} onChange={(e) => setManualUnit(e.target.value)} className="px-4 py-3 bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"> <option>mg</option><option>mcg</option><option>g</option><option>ml</option> </select> </div> <ActionButton title={`Log ${manualAmount}${manualUnit}`} backgroundColor="bg-gray-200 dark:bg-gray-600" foregroundColor="text-gray-800 dark:text-gray-200" onClick={() => handleConfirm(`${manualAmount}${manualUnit}`, age)} disabled={!manualAmount} height="h-12" /> </div> </div> );
  };

  return ( <Modal isOpen={!!drug} onClose={handleClose} title={`Log ${drug?.title || ''}`}>{renderContent()}</Modal> );
};

//============================================================================
// REUSABLE UI COMPONENTS
//============================================================================
const ActionButton: React.FC<{...}> = ({ title, icon, backgroundColor, foregroundColor, onClick, disabled = false, height = "h-16", fontSize = "text-base", className = "" }) => { const handleClick = () => { if (!disabled) { HapticManager.impact('light'); onClick(); } }; return ( <button onClick={handleClick} disabled={disabled} className={`w-full ${height} ${fontSize} ${backgroundColor} ${foregroundColor} ${className} font-semibold rounded-lg shadow-md flex items-center justify-center space-x-2 transition-all duration-150 ease-out active:scale-95 active:shadow-inner disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-gray-900 focus:ring-blue-500`}>{icon}<span>{title}</span></button> ); };
const HeaderView: React.FC = () => { const { arrestState, masterTime, timeOffset, addTimeOffset } = useArrest(); const stateInfo = { [ArrestState.Pending]: { text: "PENDING", color: "bg-gray-500" }, [ArrestState.Active]: { text: "ACTIVE", color: "bg-red-500 animate-pulse" }, [ArrestState.Rosc]: { text: "ROSC", color: "bg-green-500" }, [ArrestState.Ended]: { text: "DECEASED", color: "bg-gray-800 dark:bg-black" }, }; return ( <div className="p-4 bg-white dark:bg-gray-800 shadow-md dark:border-b dark:border-gray-700"> <div className="flex justify-between items-center mb-3"> <div className="flex flex-col items-start space-y-1"> <h1 className="text-3xl font-bold text-gray-900 dark:text-white">eResus</h1> <span className={`px-2 py-0.5 rounded-md text-xs font-black text-white ${stateInfo[arrestState].color}`}>{stateInfo[arrestState].text}</span> </div> <div className="flex flex-col items-end"> <div className="font-mono font-bold text-4xl text-blue-600 dark:text-blue-400 relative"> {timeOffset > 0 && ( <span className="absolute -left-10 top-0 text-2xl text-yellow-500">{`+${timeOffset / 60}m`}</span> )} {TimeFormatter.format(masterTime)} </div> {(arrestState === ArrestState.Active || arrestState === ArrestState.Pending) && ( <div className="flex space-x-1 mt-1"> <button onClick={() => addTimeOffset(60)} className="px-2 py-0.5 text-xs bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600">+1m</button> <button onClick={() => addTimeOffset(300)} className="px-2 py-0.5 text-xs bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600">+5m</button> <button onClick={() => addTimeOffset(600)} className="px-2 py-0.5 text-xs bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600">+10m</button> </div> )} </div> </div> {arrestState !== ArrestState.Pending && <CountersView />} </div> ); };
const CountersView: React.FC = () => { const { shockCount, adrenalineCount, amiodaroneCount, lidocaineCount } = useArrest(); const CounterItem: React.FC<{ label: string, value: number, color: string }> = ({ label, value, color }) => ( <div className={`flex flex-col items-center ${color}`}> <span className="font-mono font-bold text-xl">{value}</span> <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{label}</span> </div> ); return ( <div className="flex justify-around pt-2 border-t border-gray-200 dark:border-gray-700"> <CounterItem label="Shocks" value={shockCount} color="text-orange-500" /> <CounterItem label="Adrenaline" value={adrenalineCount} color="text-pink-500" /> <CounterItem label="Amiodarone" value={amiodaroneCount} color="text-purple-500" /> <CounterItem label="Lidocaine" value={lidocaineCount} color="text-indigo-500" /> </div> ); };
const CPRTimerView: React.FC = () => { const { cprTime } = useArrest(); const { cprCycleDuration, metronomeBPM } = useSettings(); const [isMetronomeOn, setIsMetronomeOn] = useState(false); const toggleMetronome = () => { const on = metronome.toggle(metronomeBPM); setIsMetronomeOn(on); HapticManager.impact('medium'); }; useEffect(() => { metronome.setBPM(metronomeBPM); }, [metronomeBPM]); const progress = Math.max(0, cprTime / cprCycleDuration); const circumference = 2 * Math.PI * 56; const offset = circumference - progress * circumference; const isEnding = cprTime <= 10; return ( <div className="relative w-64 h-64 flex-shrink-0 mx-auto"> <svg className="w-full h-full" viewBox="0 0 120 120"> <circle className="text-gray-200 dark:text-gray-700" strokeWidth="8" stroke="currentColor" fill="transparent" r="56" cx="60" cy="60" /> <circle className={`transition-all duration-300 ${isEnding ? 'text-red-500' : 'text-blue-500'}`} strokeWidth="8" strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" stroke="currentColor" fill="transparent" r="56" cx="60" cy="60" transform="rotate(-90 60 60)" /> </svg> <div className="absolute inset-0 flex flex-col items-center justify-center"> <span className={`font-mono text-6xl font-bold ${isEnding ? 'text-red-500' : 'text-gray-900 dark:text-white'}`}>{TimeFormatter.format(cprTime)}</span> <span className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">CPR Cycle</span> </div> <button onClick={toggleMetronome} className={`absolute -bottom-4 right-0 w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-colors ${isMetronomeOn ? 'bg-blue-500 text-white' : 'bg-white dark:bg-gray-700 text-blue-500 dark:text-blue-400'}`}><Music size={24} /></button> </div> ); };
const AdrenalineTimerView: React.FC = () => { const { timeUntilAdrenaline } = useArrest(); if (timeUntilAdrenaline === null) return null; if (timeUntilAdrenaline > 0) return ( <div className="p-3 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center space-x-2 shadow-inner"><Syringe size={20} className="text-pink-500" /><span className="font-semibold text-gray-700 dark:text-gray-200">Adrenaline due in: {TimeFormatter.format(timeUntilAdrenaline)}</span></div> ); return ( <div className="p-3 bg-red-500 rounded-lg flex items-center justify-center space-x-2 shadow-lg animate-pulse"><AlertTriangle size={20} className="text-white" /><span className="font-semibold text-white">Adrenaline Due</span></div> ); };
const AdrenalinePromptView: React.FC = () => ( <div className="p-3 bg-pink-500/80 rounded-lg flex items-center justify-center space-x-2 shadow-lg animate-pulse"><Syringe size={20} className="text-white" /><span className="font-semibold text-white">Consider giving Adrenaline</span></div> );
const AmiodaronePromptView: React.FC = () => ( <div className="p-3 bg-purple-500/80 rounded-lg flex items-center justify-center space-x-2 shadow-lg animate-pulse"><Syringe size={20} className="text-white" /><span className="font-semibold text-white">Consider giving Amiodarone</span></div> );
const AmiodaroneReminderView: React.FC = () => ( <div className="p-3 bg-purple-500/80 rounded-lg flex items-center justify-center space-x-2 shadow-lg animate-pulse"><Syringe size={20} className="text-white" /><span className="font-semibold text-white">Consider 2nd Amiodarone Dose</span></div> );
const ChecklistView: React.FC<{ title: string; items: ChecklistItem[]; onToggle: (item: ChecklistItem) => void; onHypothermiaClick?: () => void; }> = ({ title, items, onToggle, onHypothermiaClick }) => ( <div className="p-4 bg-white dark:bg-gray-800 rounded-lg shadow-md"> <h3 className="text-lg font-semibold mb-3 text-gray-800 dark:text-gray-200">{title}</h3> <div className="space-y-3"> {items.map(item => ( <button key={item.id} onClick={() => (item.id === 'hypothermia' && onHypothermiaClick) ? onHypothermiaClick() : onToggle(item)} className="w-full flex items-center text-left p-2 -m-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"><CheckCircle size={24} className={`mr-3 flex-shrink-0 ${item.isCompleted ? 'text-green-500' : 'text-gray-400 dark:text-gray-600'}`} /><span className={`flex-grow ${item.isCompleted ? 'line-through text-gray-500' : 'text-gray-800 dark:text-gray-200'}`}>{item.name}</span>{item.id === 'hypothermia' && item.hypothermiaStatus !== HypothermiaStatus.None && item.hypothermiaStatus !== HypothermiaStatus.Normothermic && ( <span className={`text-xs font-bold ml-2 ${item.hypothermiaStatus === HypothermiaStatus.Severe ? 'text-blue-500' : 'text-yellow-500'}`}>({item.hypothermiaStatus})</span> )}</button> ))} </div> </div> );
const EventLogView: React.FC = () => { const { events } = useArrest(); const scrollRef = useRef<HTMLDivElement>(null); useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }, [events]); const typeColor = (type: EventType) => { switch (type) { case EventType.Status: return "text-green-500"; case EventType.Cpr: return "text-cyan-500"; case EventType.Shock: return "text-orange-500"; case EventType.Analysis: return "text-blue-500"; case EventType.Rhythm: return "text-purple-500"; case EventType.Drug: return "text-pink-500"; case EventType.Airway: return "text-teal-500"; case EventType.Etco2: return "text-indigo-500"; case EventType.Cause: return "text-gray-500"; default: return "text-gray-700 dark:text-gray-300"; } }; return ( <div className="p-4 bg-white dark:bg-gray-800 rounded-lg shadow-md h-72 flex flex-col"> <h3 className="text-lg font-semibold mb-3 text-gray-800 dark:text-gray-200">Event Log</h3> <div ref={scrollRef} className="flex-grow overflow-y-auto pr-2 space-y-2"> {events.length === 0 ? <p className="text-gray-500 italic text-center py-4">No events logged yet.</p> : events.map(event => ( <div key={event.id} className="flex font-mono text-sm"><span className={`font-bold mr-2 ${typeColor(event.type)}`}>[{TimeFormatter.format(event.timestamp)}]</span><span className="text-gray-700 dark:text-gray-300 break-words">{event.message}</span></div> ))} </div> </div> ); };
const AlgorithmGridView: React.FC<{ onSelectPDF: (pdf: PDFIdentifiable) => void }> = ({ onSelectPDF }) => { const algorithms = [ { id: "adult_als", pdfName: "adult_als", title: "Adult ALS" }, { id: "paediatric_als", pdfName: "paediatric_als", title: "Paediatric ALS" }, { id: "newborn_ls", pdfName: "newborn_ls", title: "Newborn LS" }, { id: "post_arrest", pdfName: "post_arrest", title: "Post Arrest Care" } ]; return ( <div className="p-4 bg-white dark:bg-gray-800 rounded-lg shadow-md"> <h3 className="text-lg font-semibold mb-3 text-center text-gray-800 dark:text-gray-200">Resuscitation Council UK</h3> <div className="grid grid-cols-2 gap-3"> {algorithms.map(pdf => ( <button key={pdf.id} onClick={() => onSelectPDF(pdf)} className="p-4 h-20 bg-gray-100 dark:bg-gray-700 rounded-lg font-semibold text-gray-800 dark:text-gray-200 flex items-center justify-center text-center shadow-sm hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors active:scale-95">{pdf.title}</button> ))} </div> </div> ); };
const BottomControlsView: React.FC = () => { const { canUndo, undo } = useArrest(); return ( <div className="sticky bottom-14 z-20 p-3 bg-white/80 dark:bg-gray-800/80 backdrop-blur-md shadow-md-top border-t border-gray-200 dark:border-gray-700"> <div className="flex space-x-3"> <button onClick={undo} disabled={!canUndo} className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg font-semibold text-sm shadow-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition duration-150"><Undo size={16} className="inline-block mr-2" /> Undo</button> <SummaryModal /> <ResetModal /> </div> </div> ); };

//============================================================================
// SCREEN VIEWS
//============================================================================
const PendingView: React.FC<{ onSelectPDF: (pdf: PDFIdentifiable) => void }> = ({ onSelectPDF }) => { const { startArrest } = useArrest(); return ( <div className="p-4 space-y-6"> <ActionButton title="Start Arrest" backgroundColor="bg-red-600" foregroundColor="text-white" onClick={startArrest} height="h-24" fontSize="text-2xl" icon={<Play size={24} />} /> <AlgorithmGridView onSelectPDF={onSelectPDF} /> </div> ); };
const ActiveArrestView: React.FC<{ onSelectPDF: (pdf: PDFIdentifiable) => void; onShowOtherDrugs: () => void; onShowEtco2: () => void; onShowHypothermia: () => void; onShowDosage: (drug: DrugToLog) => void; }> = (props) => { const { uiState, analyseRhythm, logRhythm, deliverShock, logAdrenaline, logAmiodarone, logLidocaine, logAirwayPlaced, achieveROSC, endArrest, airwayPlaced, isAdrenalineAvailable, isAmiodaroneAvailable, isLidocaineAvailable, shouldShowAdrenalinePrompt, shouldShowAmiodaroneFirstDosePrompt, shouldShowAmiodaroneReminder, reversibleCauses, toggleChecklistItemCompletion } = useArrest(); const { showDosagePrompts } = useSettings(); const handleAdrenaline = () => { if (showDosagePrompts) props.onShowDosage({ type: DrugToLogType.Adrenaline, title: "Adrenaline" }); else logAdrenaline(); }; const handleAmiodarone = () => { if (showDosagePrompts) props.onShowDosage({ type: DrugToLogType.Amiodarone, title: "Amiodarone" }); else logAmiodarone(); }; const handleLidocaine = () => { if (showDosagePrompts) props.onShowDosage({ type: DrugToLogType.Lidocaine, title: "Lidocaine" }); else logLidocaine(); }; return ( <div className="p-4 space-y-6"> <div className="p-4 bg-white dark:bg-gray-800 rounded-lg shadow-md"><CPRTimerView /></div> <div className="space-y-3"> <AdrenalineTimerView /> {shouldShowAdrenalinePrompt && <AdrenalinePromptView />} {shouldShowAmiodaroneFirstDosePrompt && <AmiodaronePromptView />} {shouldShowAmiodaroneReminder && <AmiodaroneReminderView />} </div> <div className="space-y-4"> {uiState === UIState.Default && ( <ActionButton title="Analyse Rhythm" icon={<HeartPulse size={24} />} backgroundColor="bg-blue-600" foregroundColor="text-white" onClick={analyseRhythm} height="h-20" fontSize="text-xl"/> )} {uiState === UIState.Analyzing && ( <div className="p-4 bg-white dark:bg-gray-800 rounded-lg shadow-md space-y-3"> <h3 className="text-lg font-semibold text-center text-gray-800 dark:text-gray-200">Select Rhythm</h3> <div className="grid grid-cols-2 gap-3"> <ActionButton title="VF" backgroundColor="bg-orange-500" foregroundColor="text-white" onClick={() => logRhythm("VF", true)} /> <ActionButton title="VT" backgroundColor="bg-orange-500" foregroundColor="text-white" onClick={() => logRhythm("VT", true)} /> <ActionButton title="PEA" backgroundColor="bg-gray-500" foregroundColor="text-white" onClick={() => logRhythm("PEA", false)} /> <ActionButton title="Asystole" backgroundColor="bg-gray-500" foregroundColor="text-white" onClick={() => logRhythm("Asystole", false)} /> </div> <ActionButton title="ROSC" icon={<Heart size={20} />} backgroundColor="bg-green-600" foregroundColor="text-white" onClick={achieveROSC} className="col-span-2"/> </div> )} {uiState === UIState.ShockAdvised && ( <ActionButton title="Deliver Shock" icon={<Zap size={24} />} backgroundColor="bg-orange-500" foregroundColor="text-white" onClick={deliverShock} height="h-20" fontSize="text-xl"/> )} <div className="p-4 bg-white dark:bg-gray-800 rounded-lg shadow-md space-y-3"> <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Medications</h3> <div className="grid grid-cols-2 gap-3"> <ActionButton title="Adrenaline" icon={<Syringe size={18} />} backgroundColor="bg-pink-500" foregroundColor="text-white" onClick={handleAdrenaline} disabled={!isAdrenalineAvailable} /> <ActionButton title="Amiodarone" icon={<Syringe size={18} />} backgroundColor="bg-purple-500" foregroundColor="text-white" onClick={handleAmiodarone} disabled={!isAmiodaroneAvailable} /> <ActionButton title="Lidocaine" icon={<Syringe size={18} />} backgroundColor="bg-indigo-500" foregroundColor="text-white" onClick={handleLidocaine} disabled={!isLidocaineAvailable} /> <ActionButton title="Other Meds..." icon={<Pill size={18} />} backgroundColor="bg-gray-500" foregroundColor="text-white" onClick={props.onShowOtherDrugs} /> </div> </div> <div className="p-4 bg-white dark:bg-gray-800 rounded-lg shadow-md space-y-3"> <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Procedures</h3> <div className="grid grid-cols-2 gap-3"> <ActionButton title="Adv. Airway" icon={<AirVent size={18} />} backgroundColor="bg-blue-500" foregroundColor="text-white" onClick={logAirwayPlaced} disabled={airwayPlaced} /> <ActionButton title="Log ETCO2" icon={<Activity size={18} />} backgroundColor="bg-teal-500" foregroundColor="text-white" onClick={props.onShowEtco2} /> </div> </div> <div className="p-4 bg-white dark:bg-gray-800 rounded-lg shadow-md space-y-3"> <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Patient Status</h3> <div className="grid grid-cols-2 gap-3"> <ActionButton title="ROSC" icon={<Heart size={18} />} backgroundColor="bg-green-600" foregroundColor="text-white" onClick={achieveROSC} /> <ActionButton title="End Arrest" icon={<XSquare size={18} />} backgroundColor="bg-red-600" foregroundColor="text-white" onClick={endArrest} /> </div> </div> </div> <ChecklistView title="Reversible Causes (4 H's & 4 T's)" items={reversibleCauses} onToggle={toggleChecklistItemCompletion} onHypothermiaClick={props.onShowHypothermia}/> <AlgorithmGridView onSelectPDF={props.onSelectPDF} /> <EventLogView /> </div> ); };
const RoscView: React.FC<{ onSelectPDF: (pdf: PDFIdentifiable) => void; onShowOtherDrugs: () => void; }> = (props) => { const { reArrest, postROSCTasks, togglePostROSCTask } = useArrest(); return ( <div className="p-4 space-y-6"> <ActionButton title="Patient Re-Arrested" icon={<RotateCw size={24} />} backgroundColor="bg-orange-500" foregroundColor="text-white" onClick={reArrest} height="h-20" fontSize="text-xl"/> <ActionButton title="Administer Medication" icon={<Syringe size={20} />} backgroundColor="bg-gray-500" foregroundColor="text-white" onClick={props.onShowOtherDrugs} height="h-20" fontSize="text-xl"/> <ChecklistView title="Post-ROSC Care" items={postROSCTasks} onToggle={togglePostROSCTask}/> <AlgorithmGridView onSelectPDF={props.onSelectPDF} /> <EventLogView /> </div> ); };
const EndedView: React.FC<{ onSelectPDF: (pdf: PDFIdentifiable) => void; }> = (props) => { const { postMortemTasks, togglePostMortemTask } = useArrest(); return ( <div className="p-4 space-y-6"> <ChecklistView title="Actions Following Death" items={postMortemTasks} onToggle={togglePostMortemTask}/> <AlgorithmGridView onSelectPDF={props.onSelectPDF} /> <EventLogView /> </div> ); };

//============================================================================
// LOGBOOK VIEW
//============================================================================

const LogbookView: React.FC = () => {
  const { db, deviceId, isFirebaseReady } = useFirebase();
  const [logs, setLogs] = useState<ArrestDocument[]>([]);
  const [selectedLog, setSelectedLog] = useState<ArrestDocument | null>(null);

  useEffect(() => {
    if (!isFirebaseReady || !db || !deviceId) { setLogs([]); return; }
    const archiveCollectionRef = collection(db, 'artifacts', appId, 'users', deviceId, 'arrestLogsArchive');
    const q = query(archiveCollectionRef);
    const unsubscribe = onSnapshot(q, (snapshot) => { const fetchedLogs: ArrestDocument[] = []; snapshot.forEach(doc => fetchedLogs.push({ id: doc.id, ...doc.data() } as ArrestDocument & {id: string})); fetchedLogs.sort((a, b) => (b.startTime || 0) - (a.startTime || 0)); setLogs(fetchedLogs); }, (error) => console.error("Error fetching logbook:", error));
    return () => unsubscribe();
  }, [isFirebaseReady, db, deviceId]);

  return (
    <div className="h-full flex flex-col">
      <div className="flex-grow p-4 space-y-4 overflow-y-auto bg-gray-100 dark:bg-gray-900">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Logbook</h2>
        {logs.length === 0 ? ( <div className="text-center p-8 bg-white dark:bg-gray-800 rounded-lg shadow-md"><Book size={48} className="mx-auto text-gray-400" /><p className="mt-4 text-gray-600 dark:text-gray-400">No archived logs found.</p><p className="text-sm text-gray-500">Completed arrests will appear here after you reset.</p></div> ) : ( <div className="space-y-3">{logs.map(log => ( <button key={log.startTime} onClick={() => setSelectedLog(log)} className="w-full p-4 bg-white dark:bg-gray-800 rounded-lg shadow-md text-left transition hover:bg-gray-50 dark:hover:bg-gray-700"> <div className="flex justify-between items-center"><span className="font-semibold text-gray-800 dark:text-gray-200">{log.startTime ? new Date(log.startTime).toLocaleDateString() : 'Unknown Date'}</span><span className={`text-sm font-medium px-2 py-0.5 rounded ${ log.finalOutcome === 'ROSC' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300' : log.finalOutcome === 'Deceased' ? 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300' : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300' }`}>{log.finalOutcome || 'Incomplete'}</span></div> <div className="flex justify-between items-center mt-2 text-sm text-gray-500 dark:text-gray-400"><span>{log.startTime ? new Date(log.startTime).toLocaleTimeString() : 'Unknown Time'}</span><span>Duration: {TimeFormatter.format(log.totalDuration)}</span></div> </button> ))}</div> )}
      </div>
      {selectedLog && ( <Modal isOpen={!!selectedLog} onClose={() => setSelectedLog(null)} title={`Log: ${selectedLog.startTime ? new Date(selectedLog.startTime).toLocaleDateString() : 'Unknown Date'}`}> <div className="space-y-4"><div className="text-sm font-medium text-gray-700 dark:text-gray-300">Total Arrest Time: <span className="font-bold text-gray-900 dark:text-white">{TimeFormatter.format(selectedLog.totalDuration)}</span></div><div className="h-64 overflow-y-auto p-3 bg-gray-100 dark:bg-gray-900 rounded-md border border-gray-200 dark:border-gray-700">{[...(selectedLog.events || [])].reverse().map((event, idx) => ( <div key={event.id || idx} className="flex font-mono text-xs mb-1"><span className="font-bold text-blue-600 dark:text-blue-400 mr-2">[{TimeFormatter.format(event.timestamp)}]</span><span className="text-gray-700 dark:text-gray-300 break-words">{event.message}</span></div> ))}</div></div> </Modal> )}
    </div>
  );
};

//============================================================================
// SETTINGS VIEW
//============================================================================
const SettingsView: React.FC = () => {
  const [cprCycleDuration, setCprCycleDuration] = useAppStorage('cprCycleDuration', defaultSettings.cprCycleDuration);
  const [adrenalineInterval, setAdrenalineInterval] = useAppStorage('adrenalineInterval', defaultSettings.adrenalineInterval);
  const [metronomeBPM, setMetronomeBPM] = useAppStorage('metronomeBPM', defaultSettings.metronomeBPM);
  const [appearanceMode, setAppearanceMode] = useAppStorage('appearanceMode', defaultSettings.appearanceMode);
  const [showDosagePrompts, setShowDosagePrompts] = useAppStorage('showDosagePrompts', defaultSettings.showDosagePrompts);
  const Stepper: React.FC<{ label: string, value: number, onChange: (val: number) => void, min: number, max: number, step: number }> = ({ label, value, onChange, min, max, step }) => ( <div className="flex justify-between items-center"><span className="text-gray-700 dark:text-gray-300">{label}</span><div className="flex items-center space-x-2"><button onClick={() => onChange(Math.max(min, value - step))} className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 font-bold disabled:opacity-50" disabled={value <= min}>-</button><span className="font-mono text-gray-900 dark:text-white w-12 text-center">{value}</span><button onClick={() => onChange(Math.min(max, value + step))} className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 font-bold disabled:opacity-50" disabled={value >= max}>+</button></div></div> );
  return ( <div className="h-full flex flex-col"><div className="flex-grow p-4 space-y-6 overflow-y-auto bg-gray-100 dark:bg-gray-900"><h2 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h2><div className="p-4 bg-white dark:bg-gray-800 rounded-lg shadow-md space-y-4"><h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Timers</h3><Stepper label={`CPR Cycle: ${cprCycleDuration}s`} value={cprCycleDuration} onChange={setCprCycleDuration} min={60} max={300} step={10}/><Stepper label={`Adrenaline Interval: ${adrenalineInterval / 60} min`} value={adrenalineInterval} onChange={setAdrenalineInterval} min={120} max={600} step={60}/></div><div className="p-4 bg-white dark:bg-gray-800 rounded-lg shadow-md space-y-4"><h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Metronome</h3><Stepper label={`BPM: ${metronomeBPM}`} value={metronomeBPM} onChange={setMetronomeBPM} min={80} max={140} step={5}/></div><div className="p-4 bg-white dark:bg-gray-800 rounded-lg shadow-md space-y-4"><h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Medications</h3><div className="flex justify-between items-center"><div className="flex-grow pr-4"><label htmlFor="dosage-prompt" className="text-gray-700 dark:text-gray-300 cursor-pointer">Show Dosage Prompts</label><p className="text-xs text-gray-500 dark:text-gray-400">Ask for patient age or manual dose when logging drugs.</p></div><input id="dosage-prompt" type="checkbox" className="toggle-switch h-6 w-11 rounded-full bg-gray-200 dark:bg-gray-600 relative inline-flex items-center cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500" checked={showDosagePrompts} onChange={(e) => setShowDosagePrompts(e.target.checked)} style={{ WebkitAppearance: 'none', appearance: 'none', }}/> <style>{`.toggle-switch:checked { background-color: #2563eb; } .toggle-switch::before { content: ""; position: absolute; left: 2px; top: 2px; width: 20px; height: 20px; background-color: white; border-radius: 50%; transition: transform 0.2s; } .toggle-switch:checked::before { transform: translateX(20px); }`}</style></div></div><div className="p-4 bg-white dark:bg-gray-800 rounded-lg shadow-md space-y-4"><h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Appearance</h3><div className="flex space-x-2">{(Object.values(AppearanceMode)).map(mode => ( <button key={mode} onClick={() => setAppearanceMode(mode)} className={`flex-1 p-3 rounded-lg font-semibold transition-colors ${ appearanceMode === mode ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600' }`}>{mode}</button> ))}</div></div></div></div> );
};

//============================================================================
// PWA & INSTALL PROMPT COMPONENTS
//============================================================================
const usePwaMetaTags = () => { useEffect(() => { const head = document.head; const tags = [ { rel: 'manifest', href: 'manifest.json' }, { name: 'apple-mobile-web-app-capable', content: 'yes' }, { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' }, { name: 'theme-color', content: '#111827' }, { rel: 'apple-touch-icon', href: 'https://145955222.fs1.hubspotusercontent-eu1.net/hubfs/145955222/eResus.jpg' }, { rel: 'icon', href: 'https://145955222.fs1.hubspotusercontent-eu1.net/hubfs/145955222/eResus.jpg' } ]; tags.forEach(tag => { let el: HTMLLinkElement | HTMLMetaElement; const existing = tag.rel ? head.querySelector(`link[rel="${tag.rel}"]`) : head.querySelector(`meta[name="${tag.name}"]`); if (existing) head.removeChild(existing); if (tag.rel) { el = document.createElement('link'); el.rel = tag.rel; if ((tag as { href?: string }).href) (el as HTMLLinkElement).href = (tag as { href: string }).href; } else { el = document.createElement('meta'); el.name = (tag as { name: string }).name; } if (tag.content) (el as HTMLMetaElement).content = tag.content; head.appendChild(el); }); }, []); };
const PWAUpdater: React.FC = () => { const [updateAvailable, setUpdateAvailable] = useState(false); const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null); useEffect(() => { if ('serviceWorker' in navigator) { navigator.serviceWorker.register('/sw.js').then(reg => { console.log('ServiceWorker registration successful with scope: ', reg.scope); reg.onupdatefound = () => { console.log("Service Worker update found!"); const installingWorker = reg.installing; if (installingWorker) { installingWorker.onstatechange = () => { console.log("Install worker state:", installingWorker.state); if (installingWorker.state === 'installed') { if (navigator.serviceWorker.controller) { console.log("New content is available; please refresh."); setWaitingWorker(installingWorker); setUpdateAvailable(true); } else { console.log("Content is cached for offline use."); } } }; } }; }).catch(error => console.error('Service Worker registration failed:', error)); navigator.serviceWorker.addEventListener('controllerchange', () => { console.log("Service Worker controller changed, reloading..."); window.location.reload(); }); } else { console.log("Service Worker not supported in this browser."); } }, []); const refreshPage = () => { if (waitingWorker) { console.log("Sending SKIP_WAITING to waiting worker."); waitingWorker.postMessage({ type: 'SKIP_WAITING' }); setUpdateAvailable(false); } }; if (!updateAvailable) return null; return ( <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-50 p-4 bg-blue-600 text-white rounded-lg shadow-xl flex items-center space-x-4"><RefreshCw size={24} className="animate-spin" /><span className="font-semibold">A new version is available!</span><button onClick={refreshPage} className="px-3 py-1 bg-white text-blue-600 font-bold rounded-md">Refresh</button></div> ); };
const AddToHomeScreenPrompt: React.FC = () => { const [installPrompt, setInstallPrompt] = useState<Event | null>(null); const [showIosPrompt, setShowIosPrompt] = useState(false); const [isVisible, setIsVisible] = useState(false); useEffect(() => { const handler = (e: Event) => { e.preventDefault(); setInstallPrompt(e); if (!window.matchMedia('(display-mode: standalone)').matches && !localStorage.getItem('eResusInstallPromptSeen')) setIsVisible(true); }; window.addEventListener('beforeinstallprompt', handler); const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent); if (isIos && !(window.navigator as any).standalone && !localStorage.getItem('eResusInstallPromptSeen')) { setShowIosPrompt(true); setIsVisible(true); } return () => window.removeEventListener('beforeinstallprompt', handler); }, []); const handleInstall = async () => { if (installPrompt) { (installPrompt as any).prompt(); const { outcome } = await (installPrompt as any).userChoice; if (outcome === 'accepted') console.log('User accepted the A2HS prompt'); setInstallPrompt(null); } closePrompt(); }; const closePrompt = () => { setIsVisible(false); localStorage.setItem('eResusInstallPromptSeen', 'true'); }; if (!isVisible) return null; return ( <Modal isOpen={isVisible} onClose={closePrompt} title="Install eResus App"><div className="text-center space-y-4"><img src="https://145955222.fs1.hubspotusercontent-eu1.net/hubfs/145955222/eResus.jpg" alt="eResus Logo" className="w-24 h-24 mx-auto rounded-3xl mb-4" />{showIosPrompt ? ( <><p className="text-lg text-gray-800 dark:text-gray-200">To install this app on your device:</p><p className="text-gray-700 dark:text-gray-300">1. Tap the <Share size={16} className="inline-block" /> icon in your browser.</p><p className="text-gray-700 dark:text-gray-300">2. Scroll down and tap "Add to Home Screen".</p><ActionButton title="Got it!" backgroundColor="bg-blue-600" foregroundColor="text-white" onClick={closePrompt} height="h-12"/></> ) : ( <><p className="text-lg text-gray-800 dark:text-gray-200">Install eResus for quick access and offline use!</p><ActionButton title="Install App" icon={<Download size={18} />} backgroundColor="bg-blue-600" foregroundColor="text-white" onClick={handleInstall} height="h-12" disabled={!installPrompt}/></> )}</div></Modal> ); };

//============================================================================
// APP ENTRY POINT
//============================================================================

type TabID = "arrest" | "logbook" | "settings";
const PDFView: React.FC<{ pdf: PDFIdentifiable; onClose: () => void; }> = ({ pdf, onClose }) => { const pdfUrls = { "adult_als": "https://www.resus.org.uk/sites/default/files/2024-01/Adult%20Advanced%20Life%20Support%20Algorithm%202021%20Aug%202023.pdf", "paediatric_als": "https://www.resus.org.uk/sites/default/files/2021-04/Paediatric%20ALS%20Algorithm%202021.pdf", "newborn_ls": "https://www.resus.org.uk/sites/default/files/2021-05/Newborn%20Life%20Support%20Algorithm%202021.pdf", "post_arrest": "https://www.resus.org.uk/sites/default/files/2023-08/Post%20cardiac%20arrest%20rehabilitation%20algorithim%202023.pdf" }; const url = pdfUrls[pdf.pdfName as keyof typeof pdfUrls] || "#"; return ( <Modal isOpen={true} onClose={onClose} title={pdf.title}><div className="h-[70vh] flex flex-col"><iframe src={url} className="w-full h-full border-0" title={pdf.title} sandbox="allow-scripts allow-same-origin"/><a href={url} target="_blank" rel="noopener noreferrer" className="block text-center mt-4 px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700">Open in New Tab</a></div></Modal> ); };

const AppContent: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<TabID>("arrest");
  const [pdfToShow, setPdfToShow] = useState<PDFIdentifiable | null>(null);
  const arrestViewModel = useArrestViewModel();
  const { appearanceMode } = useSettings();
  const { isFirebaseReady } = useFirebase();
  const [showOtherDrugs, setShowOtherDrugs] = useState(false);
  const [showEtco2, setShowEtco2] = useState(false);
  const [showHypothermia, setShowHypothermia] = useState(false);
  const [drugForDosage, setDrugForDosage] = useState<DrugToLog | null>(null);
  usePwaMetaTags();
  useEffect(() => { const root = window.document.documentElement; if (appearanceMode === AppearanceMode.Dark || (appearanceMode === AppearanceMode.System && window.matchMedia('(prefers-color-scheme: dark)').matches)) root.classList.add('dark'); else root.classList.remove('dark'); }, [appearanceMode]);
  const renderTab = () => { if (!isFirebaseReady) return ( <div className="h-full flex items-center justify-center text-gray-500 dark:text-gray-400">Initializing...</div> ); switch (currentTab) { case "arrest": switch (arrestViewModel.arrestState) { case ArrestState.Pending: return <PendingView onSelectPDF={setPdfToShow} />; case ArrestState.Active: return <ActiveArrestView onSelectPDF={setPdfToShow} onShowOtherDrugs={() => setShowOtherDrugs(true)} onShowEtco2={() => setShowEtco2(true)} onShowHypothermia={() => setShowHypothermia(true)} onShowDosage={setDrugForDosage} />; case ArrestState.Rosc: return <RoscView onSelectPDF={setPdfToShow} onShowOtherDrugs={() => setShowOtherDrugs(true)} />; case ArrestState.Ended: return <EndedView onSelectPDF={setPdfToShow} />; default: return null; } case "logbook": return <LogbookView />; case "settings": return <SettingsView />; default: return null; } };
  if (!isFirebaseReady) return ( <div className="h-screen w-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900"><div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-blue-500"></div><p className="ml-4 text-gray-600 dark:text-gray-400">Initializing Firebase...</p></div> );

  return (
    <ArrestContext.Provider value={arrestViewModel}>
      <div className="h-screen w-screen flex flex-col font-sans bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
        {currentTab !== 'arrest' ? <HeaderView /> : null}
        <main className={`flex-grow overflow-y-auto ${currentTab === 'arrest' ? 'pb-16 md:pb-0' : 'pb-16'}`}>
          {currentTab === 'arrest' ? ( <div className="flex flex-col min-h-full"><HeaderView /><div className="flex-grow">{renderTab()}</div>{arrestViewModel.arrestState !== ArrestState.Pending && <BottomControlsView />}</div> ) : ( renderTab() )}
        </main>
        <nav className="sticky bottom-0 z-30 flex justify-around p-2 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 shadow-md-top">
          <TabButton label="Arrest" icon={<HeartPulse size={24} />} isActive={currentTab === "arrest"} onClick={() => setCurrentTab("arrest")}/>
          <TabButton label="Logbook" icon={<Book size={24} />} isActive={currentTab === "logbook"} onClick={() => setCurrentTab("logbook")}/>
          <TabButton label="Settings" icon={<Settings size={24} />} isActive={currentTab === "settings"} onClick={() => setCurrentTab("settings")}/>
        </nav>
        {pdfToShow && <PDFView pdf={pdfToShow} onClose={() => setPdfToShow(null)} />}
        <OtherDrugsModal isOpen={showOtherDrugs} onClose={() => setShowOtherDrugs(false)} />
        <Etco2Modal isOpen={showEtco2} onClose={() => setShowEtco2(false)} />
        <HypothermiaModal isOpen={showHypothermia} onClose={() => setShowHypothermia(false)} />
        <DosageEntryModal drug={drugForDosage} onClose={() => setDrugForDosage(null)} />
        <PWAUpdater />
        <AddToHomeScreenPrompt />
      </div>
    </ArrestContext.Provider>
  );
};

const TabButton: React.FC<{ label: string; icon: React.ReactNode; isActive: boolean; onClick: () => void; }> = ({ label, icon, isActive, onClick }) => ( <button onClick={onClick} className={`flex flex-col items-center justify-center w-full p-2 rounded-lg transition-colors ${isActive ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>{icon}<span className="text-xs font-semibold">{label}</span></button> );

const AppWrapper: React.FC = () => {
  return (
    <React.StrictMode>
      <FirebaseProvider>
        <AppSettingsProvider>
          <AppContent />
        </AppSettingsProvider>
      </FirebaseProvider>
    </React.StrictMode>
  );
};

export default AppWrapper;

