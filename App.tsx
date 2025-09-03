import React, { useReducer, useEffect, useRef, useState } from 'react';
import type { LogEntry, ArrestState, LogEventType, RhythmType } from './types';
import { REVERSIBLE_CAUSES, POST_ROSC_TASKS } from './types';
import { BoltIcon, SyringeIcon, HeartPulseIcon, StopIcon, MusicNoteIcon, CheckCircleIcon, AirwayIcon, LungsIcon } from './components/Icons';

// --- CONSTANTS ---
const CPR_CYCLE_SECONDS = 120;
const ADRENALINE_INTERVAL_SECONDS = 240; // 4 minutes
const METRONOME_BPM = 110;


// --- UTILITY FUNCTIONS ---
const formatTime = (timeInSeconds: number): string => {
  const minutes = Math.floor(timeInSeconds / 60).toString().padStart(2, '0');
  const seconds = (timeInSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
};

const triggerHapticFeedback = () => {
  if (navigator.vibrate) {
    navigator.vibrate(50);
  }
};

// --- STATE MANAGEMENT (useReducer) ---
interface AppState {
  arrestState: ArrestState;
  startTime: number | null;
  masterTime: number;
  cprTime: number;
  cprCycleStartTime: number;
  lastAdrenalineTime: number | null;
  events: LogEntry[];
  adrenalineCount: number;
  amiodaroneCount: number;
  lidocaineCount: number;
  shockCount: number;
  airwayPlaced: boolean;
  uiState: 'default' | 'analyzing' | 'shock_advised';
  metronomeOn: boolean;
  reversibleCauses: Record<string, boolean>;
  postRoscTasks: Record<string, boolean>;
  antiarrhythmicGiven: 'amiodarone' | 'lidocaine' | null;
}

type AppAction =
  | { type: 'START_ARREST' }
  | { type: 'TICK' }
  | { type: 'START_RHYTHM_ANALYSIS' }
  | { type: 'LOG_RHYTHM_TYPE'; payload: RhythmType }
  | { type: 'DELIVER_SHOCK' }
  | { type: 'LOG_ADRENALINE' }
  | { type: 'LOG_AMIODARONE' }
  | { type: 'LOG_LIDOCAINE' }
  | { type: 'LOG_AIRWAY' }
  | { type: 'LOG_ETCO2'; payload: string }
  | { type: 'LOG_ROSC' }
  | { type: 'RE_ARREST' }
  | { type: 'END_ARREST' }
  | { type: 'TOGGLE_METRONOME' }
  | { type: 'TOGGLE_REVERSIBLE_CAUSE'; payload: string }
  | { type: 'TOGGLE_POST_ROSC_TASK'; payload: string }
  | { type: 'RESET' };

const initialState: AppState = {
  arrestState: 'PENDING',
  startTime: null,
  masterTime: 0,
  cprTime: CPR_CYCLE_SECONDS,
  cprCycleStartTime: 0,
  lastAdrenalineTime: null,
  events: [],
  adrenalineCount: 0,
  amiodaroneCount: 0,
  lidocaineCount: 0,
  shockCount: 0,
  airwayPlaced: false,
  uiState: 'default',
  metronomeOn: false,
  reversibleCauses: { ...REVERSIBLE_CAUSES },
  postRoscTasks: { ...POST_ROSC_TASKS },
  antiarrhythmicGiven: null,
};

const appReducer = (state: AppState, action: AppAction): AppState => {
  if (state.arrestState === 'ENDED' && !['RESET', 'TOGGLE_METRONOME'].includes(action.type)) return state;
  if (state.arrestState === 'PENDING' && !['START_ARREST', 'RESET'].includes(action.type)) return state;
  
  const newEvent = (message: string, type: LogEventType): LogEntry => ({ timestamp: state.masterTime, message, type });

  switch (action.type) {
    case 'START_ARREST':
      const startTime = Date.now();
      return { 
          ...initialState,
          arrestState: 'ACTIVE', 
          startTime: startTime,
          events: [newEvent(`Arrest Started at ${new Date(startTime).toLocaleTimeString()}`, 'status')] 
      };
    case 'TICK': {
      if (!state.startTime || (state.arrestState !== 'ACTIVE' && state.arrestState !== 'ROSC')) return state;
      
      const newMasterTime = Math.floor((Date.now() - state.startTime) / 1000);
      let newCprTime = CPR_CYCLE_SECONDS - (newMasterTime - state.cprCycleStartTime);
      let events = state.events;
      let cprCycleStartTime = state.cprCycleStartTime;

      if (newCprTime < 0 && state.arrestState === 'ACTIVE') {
        newCprTime = CPR_CYCLE_SECONDS;
        cprCycleStartTime = newMasterTime;
        events = [...state.events, newEvent('CPR Cycle Complete. New cycle started.', 'cpr')];
      }
      return { ...state, masterTime: newMasterTime, cprTime: newCprTime, events, cprCycleStartTime };
    }
    case 'START_RHYTHM_ANALYSIS':
        return { ...state, uiState: 'analyzing', events: [...state.events, newEvent('Rhythm Analysis Paused', 'analysis')] };
    case 'LOG_RHYTHM_TYPE':
        const isShockable = action.payload === 'VF / VT';
        return { 
            ...state, 
            uiState: isShockable ? 'shock_advised' : 'default', 
            events: [...state.events, newEvent(`Rhythm is ${action.payload}`, 'rhythm')]
        };
    case 'DELIVER_SHOCK':
      const newShockCount = state.shockCount + 1;
      return { ...state, shockCount: newShockCount, uiState: 'default', cprCycleStartTime: state.masterTime, events: [...state.events, newEvent(`Shock ${newShockCount} Delivered. Resuming CPR.`, 'shock')] };
    case 'LOG_ADRENALINE':
      const newAdrenalineCount = state.adrenalineCount + 1;
      return { ...state, adrenalineCount: newAdrenalineCount, lastAdrenalineTime: state.masterTime, events: [...state.events, newEvent(`Adrenaline (1mg) Given - Dose ${newAdrenalineCount}`, 'drug')] };
    case 'LOG_AMIODARONE':
      if (state.amiodaroneCount >= 2 || state.antiarrhythmicGiven === 'lidocaine') return state;
      const newAmiodaroneCount = state.amiodaroneCount + 1;
      const amioMessage = newAmiodaroneCount === 1 ? 'Amiodarone (300mg) Given - Dose 1' : 'Amiodarone (150mg) Given - Dose 2';
      return { ...state, amiodaroneCount: newAmiodaroneCount, antiarrhythmicGiven: 'amiodarone', events: [...state.events, newEvent(amioMessage, 'drug')] };
    case 'LOG_LIDOCAINE':
      if (state.lidocaineCount >= 2 || state.antiarrhythmicGiven === 'amiodarone') return state;
      const newLidocaineCount = state.lidocaineCount + 1;
      const lidoMessage = `Lidocaine (100mg) Given - Dose ${newLidocaineCount}`;
      return { ...state, lidocaineCount: newLidocaineCount, antiarrhythmicGiven: 'lidocaine', events: [...state.events, newEvent(lidoMessage, 'drug')] };
    case 'LOG_AIRWAY':
        if (state.airwayPlaced) return state;
        return { ...state, airwayPlaced: true, events: [...state.events, newEvent('Advanced Airway Placed', 'airway')] };
    case 'LOG_ETCO2':
        return { ...state, events: [...state.events, newEvent(`ETCO2: ${action.payload} mmHg`, 'etco2')] };
    case 'LOG_ROSC':
      return { ...state, arrestState: 'ROSC', events: [...state.events, newEvent('Return of Spontaneous Circulation (ROSC)', 'status')] };
    case 'RE_ARREST':
      return { ...state, arrestState: 'ACTIVE', cprCycleStartTime: state.masterTime, events: [...state.events, newEvent('Patient Re-Arrested. CPR Resumed.', 'status')]};
    case 'END_ARREST':
      const endTime = new Date();
      return { ...state, arrestState: 'ENDED', events: [...state.events, newEvent(`Arrest Ended (Patient Deceased) at ${endTime.toLocaleTimeString()}`, 'status')] };
    case 'TOGGLE_METRONOME':
      return { ...state, metronomeOn: !state.metronomeOn };
    case 'TOGGLE_REVERSIBLE_CAUSE':
      const updatedCauses = { ...state.reversibleCauses, [action.payload]: !state.reversibleCauses[action.payload] };
      const causeMessage = `Reversible Cause: ${action.payload} ${updatedCauses[action.payload] ? 'considered/excluded' : 'unchecked'}.`;
      return { ...state, reversibleCauses: updatedCauses, events: [...state.events, newEvent(causeMessage, 'cause')] };
    case 'TOGGLE_POST_ROSC_TASK':
        const updatedTasks = { ...state.postRoscTasks, [action.payload]: !state.postRoscTasks[action.payload] };
        const taskMessage = `Post-ROSC Care: ${action.payload} ${updatedTasks[action.payload] ? 'completed' : 'unchecked'}.`;
        return { ...state, postRoscTasks: updatedTasks, events: [...state.events, newEvent(taskMessage, 'status')] };
    case 'RESET':
      return { ...initialState, reversibleCauses: { ...REVERSIBLE_CAUSES }, postRoscTasks: { ...POST_ROSC_TASKS }};
    default:
      return state;
  }
};

// --- UI HELPER COMPONENTS ---

const getLogColorClass = (type: LogEventType): string => {
    switch (type) {
        case 'status': return 'text-green-400';
        case 'cpr': return 'text-cyan-400';
        case 'shock': return 'text-amber-400';
        case 'analysis': return 'text-blue-400';
        case 'rhythm': return 'text-purple-400';
        case 'drug': return 'text-orange-400';
        case 'airway': return 'text-indigo-400';
        case 'etco2': return 'text-teal-400';
        case 'cause': return 'text-slate-400';
        default: return 'text-slate-300';
    }
};

const ArrestStatusIndicator: React.FC<{status: ArrestState}> = ({ status }) => {
    const statusStyles: Record<ArrestState, {text: string, className: string}> = {
        PENDING: { text: 'PENDING', className: 'bg-slate-500' },
        ACTIVE: { text: 'ACTIVE', className: 'bg-red-500 animate-pulse' },
        ROSC: { text: 'ROSC', className: 'bg-green-500' },
        ENDED: { text: 'ENDED', className: 'bg-slate-700' },
    };
    const { text, className } = statusStyles[status];
    return (
        <div className="flex items-center gap-2">
            <span className={`px-2 py-1 text-xs font-bold tracking-wider text-white rounded ${className}`}>{text}</span>
        </div>
    );
};

const CircularProgress: React.FC<{cprTime: number, cycleEnded: boolean}> = ({ cprTime, cycleEnded }) => {
    const percentage = (cprTime / CPR_CYCLE_SECONDS) * 100;
    const radius = 56;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = cprTime >= 0 ? circumference - (percentage / 100) * circumference : circumference;
    const flashClass = cycleEnded ? 'animate-ping-once' : '';

    return (
        <div className={`relative w-40 h-40 ${flashClass}`}>
            <svg className="w-full h-full transform -rotate-90" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r={radius} strokeWidth="8" className="text-slate-700" stroke="currentColor" fill="transparent" />
                <circle
                    cx="60" cy="60" r={radius} strokeWidth="8"
                    className="text-cyan-400" stroke="currentColor" fill="transparent"
                    strokeLinecap="round" strokeDasharray={circumference}
                    strokeDashoffset={strokeDashoffset}
                    style={{ transition: 'stroke-dashoffset 0.5s linear' }}
                />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center" aria-live="polite">
                 <span className="text-4xl font-mono text-cyan-400">{formatTime(Math.max(0, cprTime))}</span>
                 <span className="text-xs text-slate-400 tracking-wider">CPR CYCLE</span>
            </div>
        </div>
    );
};

const AdrenalineTimer: React.FC<{masterTime: number, lastAdrenalineTime: number | null}> = ({ masterTime, lastAdrenalineTime }) => {
    if (lastAdrenalineTime === null) return null;
    
    const timeSince = masterTime - lastAdrenalineTime;
    if (timeSince > ADRENALINE_INTERVAL_SECONDS) return null;

    const timeRemaining = ADRENALINE_INTERVAL_SECONDS - timeSince;
    const percentage = (timeRemaining / ADRENALINE_INTERVAL_SECONDS) * 100;

    return (
        <div className="bg-orange-900/50 rounded-lg p-3 text-center">
            <div className="text-sm font-semibold text-orange-300">Next Adrenaline Due:</div>
            <div className="text-2xl font-mono text-orange-300 my-1">{formatTime(timeRemaining)}</div>
            <div className="w-full bg-orange-800/70 rounded-full h-2.5">
                <div className="bg-orange-500 h-2.5 rounded-full" style={{ width: `${percentage}%` }}></div>
            </div>
        </div>
    );
}

interface ActionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { largeText?: boolean }

const ActionButton: React.FC<ActionButtonProps> = ({ children, className = '', disabled = false, largeText = false, ...props }) => (
    <button
        {...props}
        onClick={(e) => {
            if (!disabled && props.onClick) {
                triggerHapticFeedback();
                props.onClick(e);
            }
        }}
        disabled={disabled}
        className={`w-full h-20 flex flex-col items-center justify-center p-2 text-center rounded-xl shadow-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 transition-all transform active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 disabled:bg-slate-700 ${largeText ? 'text-xl' : 'text-md'} font-semibold ${className}`}
    >
        {children}
    </button>
);

const Checklist: React.FC<{title: string, items: Record<string, boolean>, onToggle: (item: string) => void}> = ({ title, items, onToggle }) => {
    const [isOpen, setIsOpen] = useState(true);

    return (
        <div className="bg-gray-800/50 rounded-lg p-4">
            <button onClick={() => setIsOpen(!isOpen)} className="w-full text-left text-lg font-bold flex justify-between items-center text-slate-200">
                <span>{title}</span>
                <span className={`transform transition-transform ${isOpen ? 'rotate-180' : ''}`}>▼</span>
            </button>
            {isOpen && (
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                    {Object.entries(items).map(([item, isChecked]) => (
                        <div key={item} onClick={() => onToggle(item)} className="flex items-center cursor-pointer p-2 -m-2 rounded-md hover:bg-gray-700/50">
                           <CheckCircleIcon checked={isChecked} />
                            <span className={`transition-colors ${isChecked ? 'line-through text-slate-500' : 'text-slate-300'}`}>{item}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

const SummaryModal: React.FC<{ events: LogEntry[]; onClose: () => void, masterTime: number }> = ({ events, onClose, masterTime }) => {
    const summaryText = `eResus Event Summary\nTotal Arrest Time: ${formatTime(masterTime)}\n\n--- Event Log ---\n${events.map(e => `[${formatTime(e.timestamp)}] ${e.message}`).join('\n')}`;
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(summaryText).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center p-4 z-50">
            <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-lg max-h-full flex flex-col border border-gray-700">
                <div className="p-4 border-b border-gray-700 flex justify-between items-center">
                    <h2 className="text-xl font-bold">Event Summary</h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-white text-2xl">&times;</button>
                </div>
                <div className="p-4 overflow-y-auto">
                    <pre className="text-sm whitespace-pre-wrap bg-gray-900 p-3 rounded-md text-slate-200">{summaryText}</pre>
                </div>
                <div className="p-4 border-t border-gray-700 flex gap-4">
                    <button onClick={handleCopy} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg">
                        {copied ? 'Copied!' : 'Copy to Clipboard'}
                    </button>
                    <button onClick={onClose} className="flex-1 bg-slate-600 hover:bg-slate-700 text-white font-bold py-2 px-4 rounded-lg">
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};

const ResetModal: React.FC<{ events: LogEntry[], masterTime: number, onClose: () => void, onReset: () => void }> = ({ events, masterTime, onClose, onReset }) => {
    const [copied, setCopied] = useState(false);
    
    const handleCopyAndReset = () => {
        const summaryText = `eResus Event Summary\nTotal Arrest Time: ${formatTime(masterTime)}\n\n--- Event Log ---\n${events.map(e => `[${formatTime(e.timestamp)}] ${e.message}`).join('\n')}`;
        navigator.clipboard.writeText(summaryText).then(() => {
            setCopied(true);
            setTimeout(() => { onReset(); }, 1000);
        });
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center p-4 z-50">
            <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-sm border border-gray-700 text-center">
                <div className="p-6">
                    <h2 className="text-xl font-bold">Reset Arrest Log?</h2>
                    <p className="text-slate-400 mt-2">This action cannot be undone. You can copy the log to your clipboard before resetting.</p>
                </div>
                <div className="p-4 flex flex-col gap-3 border-t border-gray-700">
                    <button onClick={handleCopyAndReset} disabled={copied} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg disabled:opacity-50">
                        {copied ? 'Copied! Resetting...' : 'Copy Log & Reset'}
                    </button>
                     <button onClick={onReset} className="w-full bg-red-800/80 hover:bg-red-700 text-white font-bold py-3 px-4 rounded-lg">
                        Reset Anyway
                    </button>
                    <button onClick={onClose} className="w-full text-slate-300 hover:bg-gray-700 font-bold py-2 px-4 rounded-lg mt-1">
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
};

const EndArrestModal: React.FC<{ onClose: () => void, onConfirm: () => void }> = ({ onClose, onConfirm }) => (
    <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center p-4 z-50">
        <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-sm border border-gray-700 text-center">
            <div className="p-6">
                <h2 className="text-xl font-bold">Confirm End of Arrest</h2>
                <p className="text-slate-400 mt-2">This will log the patient as deceased at the current time. This action is final.</p>
            </div>
            <div className="p-4 flex flex-col gap-3 border-t border-gray-700">
                <button onClick={onConfirm} className="w-full bg-red-800/80 hover:bg-red-700 text-white font-bold py-3 px-4 rounded-lg">
                    Confirm (Patient Deceased)
                </button>
                <button onClick={onClose} className="w-full text-slate-300 hover:bg-gray-700 font-bold py-2 px-4 rounded-lg mt-1">
                    Cancel
                </button>
            </div>
        </div>
    </div>
);

const Etco2Modal: React.FC<{ onClose: () => void, onConfirm: (value: string) => void }> = ({ onClose, onConfirm }) => {
    const [value, setValue] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);
    
    const handleConfirm = () => {
        if (value.trim()) {
            onConfirm(value.trim());
        }
    };
    
    return (
         <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center p-4 z-50">
            <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-sm border border-gray-700 text-center">
                <div className="p-6">
                    <h2 className="text-xl font-bold">Log ETCO2 Value</h2>
                    <p className="text-slate-400 mt-2">Enter the current end-tidal CO2 reading in mmHg.</p>
                    <input
                        ref={inputRef}
                        type="number"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleConfirm()}
                        className="mt-4 w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-center text-xl"
                        placeholder="e.g., 35"
                    />
                </div>
                <div className="p-4 flex gap-3 border-t border-gray-700">
                    <button onClick={onClose} className="flex-1 text-slate-300 hover:bg-gray-700 font-bold py-3 px-4 rounded-lg">
                        Cancel
                    </button>
                    <button onClick={handleConfirm} className="flex-1 bg-teal-600 hover:bg-teal-700 text-white font-bold py-3 px-4 rounded-lg">
                        Log Value
                    </button>
                </div>
            </div>
        </div>
    );
};


const ActionSection: React.FC<{title: string, children: React.ReactNode}> = ({ title, children }) => (
    <div className="bg-gray-800/50 rounded-lg p-3">
        <h2 className="text-sm font-bold mb-3 text-slate-400 tracking-wider uppercase">{title}</h2>
        <div className="grid grid-cols-2 gap-3">
            {children}
        </div>
    </div>
);


// --- MAIN APP COMPONENT ---
const App: React.FC = () => {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const metronomeIntervalRef = useRef<number | null>(null);
  const timerIdRef = useRef<number | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [showEndArrestModal, setShowEndArrestModal] = useState(false);
  const [showEtco2Modal, setShowEtco2Modal] = useState(false);
  const [cprCycleEnded, setCprCycleEnded] = useState(false);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Robust main timer effect
  useEffect(() => {
    if (timerIdRef.current) clearInterval(timerIdRef.current);
    
    if (state.arrestState === 'ACTIVE' || state.arrestState === 'ROSC') {
      timerIdRef.current = window.setInterval(() => dispatch({ type: 'TICK' }), 1000);
    }
    
    return () => { if (timerIdRef.current) clearInterval(timerIdRef.current); };
  }, [state.arrestState]);
  
  // Metronome effect
  useEffect(() => {
    if (state.metronomeOn) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      const playBeep = () => {
        if (!audioCtxRef.current) return;
        const oscillator = audioCtxRef.current.createOscillator();
        const gainNode = audioCtxRef.current.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, audioCtxRef.current.currentTime);
        gainNode.gain.setValueAtTime(0.3, audioCtxRef.current.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtxRef.current.currentTime + 0.1);
        oscillator.connect(gainNode);
        gainNode.connect(audioCtxRef.current.destination);
        oscillator.start();
        oscillator.stop(audioCtxRef.current.currentTime + 0.1);
      };
      const intervalTime = (60 / METRONOME_BPM) * 1000;
      metronomeIntervalRef.current = window.setInterval(playBeep, intervalTime);
    }
    return () => {
      if (metronomeIntervalRef.current) clearInterval(metronomeIntervalRef.current);
      if (audioCtxRef.current?.state !== 'closed') audioCtxRef.current?.close().catch(console.error);
    };
  }, [state.metronomeOn]);
  
  // Auto-scroll event log
  useEffect(() => {
    if (logContainerRef.current) logContainerRef.current.scrollTop = 0;
  }, [state.events]);

  // CPR cycle end visual feedback
  useEffect(() => {
    if (state.cprTime === CPR_CYCLE_SECONDS && state.arrestState === 'ACTIVE' && state.masterTime > 0) {
        setCprCycleEnded(true);
        setTimeout(() => setCprCycleEnded(false), 1000); // Animation duration
    }
  }, [state.cprTime, state.arrestState, state.masterTime]);


  const handleReset = () => {
      setShowResetModal(false);
      dispatch({ type: 'RESET' });
  };

  const handleEndArrest = () => {
    setShowEndArrestModal(false);
    dispatch({ type: 'END_ARREST' });
  };

  const handleLogEtco2 = (value: string) => {
    dispatch({ type: 'LOG_ETCO2', payload: value });
    setShowEtco2Modal(false);
  };

  const isActionDisabled = state.arrestState !== 'ACTIVE';

  const renderActiveArrestActions = () => {
    switch (state.uiState) {
        case 'analyzing':
            return (
                <ActionSection title="Select Rhythm">
                    <ActionButton onClick={() => dispatch({type: 'LOG_RHYTHM_TYPE', payload: 'VF / VT'})} className="bg-amber-500 hover:bg-amber-600 text-black col-span-2">VF / VT (Shockable)</ActionButton>
                    <ActionButton onClick={() => dispatch({type: 'LOG_RHYTHM_TYPE', payload: 'PEA'})} className="bg-slate-600 hover:bg-slate-500 text-white">PEA</ActionButton>
                    <ActionButton onClick={() => dispatch({type: 'LOG_RHYTHM_TYPE', payload: 'Asystole'})} className="bg-slate-600 hover:bg-slate-500 text-white">Asystole</ActionButton>
                </ActionSection>
            );
        case 'shock_advised':
            return (
                 <ActionSection title="Shock">
                     <ActionButton onClick={() => dispatch({type: 'DELIVER_SHOCK'})} className="bg-amber-500 hover:bg-amber-600 text-black col-span-2"><BoltIcon/>Deliver Shock</ActionButton>
                </ActionSection>
            );
        case 'default':
        default:
            return (
                 <>
                    <ActionSection title="Rhythm & Shock">
                        <ActionButton onClick={() => dispatch({ type: 'START_RHYTHM_ANALYSIS' })} className="bg-blue-600 hover:bg-blue-700 text-white col-span-2"><BoltIcon/> Analyse Rhythm</ActionButton>
                    </ActionSection>
                    <ActionSection title="Medications">
                         <ActionButton onClick={() => dispatch({ type: 'LOG_ADRENALINE' })} className="bg-orange-500 hover:bg-orange-600 text-white col-span-2"><SyringeIcon/> Adrenaline</ActionButton>
                         <ActionButton onClick={() => dispatch({ type: 'LOG_AMIODARONE' })} className="bg-purple-600 hover:bg-purple-700 text-white" disabled={state.shockCount < 3 || state.amiodaroneCount >= 2 || state.antiarrhythmicGiven === 'lidocaine'}>
                            <SyringeIcon/> Amiodarone
                        </ActionButton>
                         <ActionButton onClick={() => dispatch({ type: 'LOG_LIDOCAINE' })} className="bg-pink-600 hover:bg-pink-700 text-white" disabled={state.shockCount < 3 || state.lidocaineCount >= 2 || state.antiarrhythmicGiven === 'amiodarone'}>
                            <SyringeIcon/> Lidocaine
                        </ActionButton>
                    </ActionSection>
                     <ActionSection title="Procedures">
                        <ActionButton onClick={() => dispatch({ type: 'LOG_AIRWAY' })} className="bg-indigo-600 hover:bg-indigo-700 text-white" disabled={state.airwayPlaced}>
                            <AirwayIcon/> Advanced Airway
                        </ActionButton>
                         <ActionButton onClick={() => setShowEtco2Modal(true)} className="bg-teal-600 hover:bg-teal-700 text-white">
                            <LungsIcon/> Log ETCO2
                        </ActionButton>
                    </ActionSection>
                    <ActionSection title="Patient Status">
                        <ActionButton onClick={() => dispatch({ type: 'LOG_ROSC' })} className="bg-green-600 hover:bg-green-700 text-white"><HeartPulseIcon/> ROSC</ActionButton>
                        <ActionButton onClick={() => setShowEndArrestModal(true)} className="bg-red-800 hover:bg-red-700 text-white" disabled={state.arrestState === 'ENDED'}><StopIcon /> End Arrest</ActionButton>
                    </ActionSection>
                 </>
            );
    }
  }


  return (
    <div className="bg-gray-900 text-slate-100 min-h-screen font-sans flex flex-col">
       <style>{`.animate-ping-once { animation: ping 1s cubic-bezier(0, 0, 0.2, 1); }`}</style>
       {showSummary && <SummaryModal events={state.events} masterTime={state.masterTime} onClose={() => setShowSummary(false)} />}
       {showResetModal && <ResetModal events={state.events} masterTime={state.masterTime} onClose={() => setShowResetModal(false)} onReset={handleReset} />}
       {showEndArrestModal && <EndArrestModal onClose={() => setShowEndArrestModal(false)} onConfirm={handleEndArrest} />}
       {showEtco2Modal && <Etco2Modal onClose={() => setShowEtco2Modal(false)} onConfirm={handleLogEtco2} />}
      
      <header className="sticky top-0 bg-gray-900/80 backdrop-blur-sm p-4 flex justify-between items-start shadow-lg z-10 border-b border-gray-800">
        <div>
            <h1 className="text-xl font-bold text-slate-200">eResus</h1>
            <div className="mt-1"><ArrestStatusIndicator status={state.arrestState} /></div>
        </div>
        <div className="text-right">
            <div aria-live="polite" className={`text-6xl font-mono tracking-tight ${state.arrestState === 'ROSC' ? 'text-green-400' : 'text-amber-400'}`}>
              {formatTime(state.masterTime)}
            </div>
            {state.startTime && (
              <div className="flex justify-end items-baseline gap-x-4 gap-y-1 flex-wrap mt-1">
                  <div className="text-xs text-slate-400 font-semibold tracking-wider">
                      SHOCKS: <span className="text-amber-400 font-bold text-sm">{state.shockCount}</span>
                  </div>
                  <div className="text-xs text-slate-400 font-semibold tracking-wider">
                      ADRENALINE: <span className="text-orange-400 font-bold text-sm">{state.adrenalineCount}</span>
                  </div>
                  <div className="text-xs text-slate-400 font-semibold tracking-wider">
                      AMIODARONE: <span className="text-purple-400 font-bold text-sm">{state.amiodaroneCount}</span>
                  </div>
                  <div className="text-xs text-slate-400 font-semibold tracking-wider">
                      LIDOCAINE: <span className="text-pink-400 font-bold text-sm">{state.lidocaineCount}</span>
                  </div>
              </div>
            )}
            <div className="text-xs text-slate-400 h-4 mt-1">{state.startTime ? `Start Time: ${new Date(state.startTime).toLocaleTimeString()}` : 'Awaiting Start'}</div>
        </div>
      </header>

      <main className="flex-grow p-4 space-y-4">
        {state.arrestState === 'PENDING' ? (
            <div className="h-full flex items-center justify-center">
                <ActionButton onClick={() => dispatch({ type: 'START_ARREST' })} className="bg-red-600 hover:bg-red-700 text-white h-36 text-3xl">
                    Start Arrest
                </ActionButton>
            </div>
        ) : (
            <>
            <div className="bg-gray-800/50 rounded-lg p-4 flex items-center justify-around">
                <CircularProgress cprTime={state.cprTime} cycleEnded={cprCycleEnded} />
                <button onClick={() => dispatch({ type: 'TOGGLE_METRONOME' })} className={`p-4 rounded-full transition-colors self-center ${state.metronomeOn ? 'bg-green-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-slate-300'}`}>
                    <MusicNoteIcon />
                </button>
            </div>
            
            <div className="space-y-4">
                {state.arrestState === 'ACTIVE' && state.lastAdrenalineTime !== null && <AdrenalineTimer masterTime={state.masterTime} lastAdrenalineTime={state.lastAdrenalineTime} />}
                
                {state.arrestState === 'ROSC' ? (
                    <>
                        <ActionSection title="Patient Status">
                            <ActionButton onClick={() => dispatch({ type: 'RE_ARREST'})} className="bg-amber-600 hover:bg-amber-700 text-white col-span-2"><HeartPulseIcon/> Patient Re-Arrested</ActionButton>
                        </ActionSection>
                        <Checklist title="Post-ROSC Care" items={state.postRoscTasks} onToggle={(task) => dispatch({type: 'TOGGLE_POST_ROSC_TASK', payload: task})} />
                    </>
                ) : isActionDisabled ? null : (
                    renderActiveArrestActions()
                )}
            </div>
            
            {state.arrestState !== 'ROSC' && <Checklist title="4 H's & 4 T's" items={state.reversibleCauses} onToggle={(cause) => dispatch({type: 'TOGGLE_REVERSIBLE_CAUSE', payload: cause})} />}

            <div className="bg-gray-800/50 rounded-lg p-4 h-72 flex flex-col">
                <h2 className="text-lg font-bold mb-2 flex-shrink-0 text-slate-200">Event Log</h2>
                <div ref={logContainerRef} className="overflow-y-auto flex-grow pr-2">
                    <ul className="space-y-2 text-base">
                        {state.events.slice().reverse().map((event, index) => (
                            <li key={index} className="flex items-baseline">
                                <span className={`font-mono mr-3 ${getLogColorClass(event.type)}`}>[{formatTime(event.timestamp)}]</span>
                                <span className="text-slate-300">{event.message}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
            </>
        )}
      </main>
      
      {state.arrestState !== 'PENDING' && (
      <footer className="sticky bottom-0 bg-gray-900/80 backdrop-blur-sm p-3 flex gap-3 z-10 border-t border-gray-800">
        <button onClick={() => setShowSummary(true)} className="flex-1 bg-slate-600 hover:bg-slate-700 text-white font-bold py-3 px-4 rounded-lg disabled:opacity-50" disabled={state.events.length === 0}>
            View Summary
        </button>
        <button onClick={() => setShowResetModal(true)} className="flex-1 bg-red-800/80 hover:bg-red-700 text-white font-bold py-3 px-4 rounded-lg">
            Reset
        </button>
      </footer>
      )}
    </div>
  );
};

export default App;
