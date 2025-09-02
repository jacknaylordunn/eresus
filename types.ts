
export type LogEventType = 'status' | 'cpr' | 'analysis' | 'shock' | 'drug' | 'airway' | 'cause' | 'rhythm' | 'etco2';
export type RhythmType = 'VF / VT' | 'PEA' | 'Asystole';

export interface LogEntry {
  timestamp: number;
  message: string;
  type: LogEventType;
}

export type ArrestState = 'PENDING' | 'ACTIVE' | 'ROSC' | 'ENDED';

export const REVERSIBLE_CAUSES = {
  Hypoxia: false,
  Hypovolemia: false,
  'Hypo/Hyperkalaemia': false,
  Hypothermia: false,
  Thrombosis: false,
  Tamponade: false,
  Toxins: false,
  'Tension Pneumothorax': false,
};

export const POST_ROSC_TASKS = {
    'Optimise Ventilation & Oxygenation': false,
    '12-Lead ECG': false,
    'Treat Hypotension (SBP < 90)': false,
    'Check Blood Glucose': false,
    'Consider Temperature Control': false,
    'Identify & Treat Causes': false,
};
