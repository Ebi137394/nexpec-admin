// src/components/inspector/academy/constants/academyData.ts

export interface Course {
  id: string;
  title: string;
  subtitle: string;
  instructor: string;
  duration: string;
  totalModules: number;
  completedModules: number;
  progress: number; // 0–100
  category: 'nde' | 'safety' | 'codes' | 'corrosion' | 'practical' | 'digital';
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  thumbnailIcon: string; // Ionicon name
  accentColor: string;
  description: string;
  modules: CourseModule[];
  tags: string[];
}

export interface CourseModule {
  id: string;
  title: string;
  duration: string;
  type: 'video' | 'quiz' | 'reading' | 'practical';
  completed: boolean;
  locked: boolean;
}

export const COURSES_DATA: Course[] = [
  {
    id: 'crs-001',
    title: 'Advanced UT Techniques',
    subtitle: 'Master PAUT, TOFD & Corrosion Mapping',
    instructor: 'Dr. Ahmed Al-Rashid',
    duration: '4h 30m',
    totalModules: 8,
    completedModules: 5,
    progress: 70,
    category: 'nde',
    difficulty: 'advanced',
    thumbnailIcon: 'radio-outline',
    accentColor: '#00CEC9',
    description:
      'Deep-dive into advanced ultrasonic techniques including Phased Array (PAUT), Time-of-Flight Diffraction (TOFD), and automated corrosion mapping. Learn to interpret S-scans, D-scans, and C-scans for comprehensive weld and thickness assessments.',
    modules: [
      { id: 'm1', title: 'UT Physics Refresher', duration: '25m', type: 'video', completed: true, locked: false },
      { id: 'm2', title: 'PAUT Fundamentals', duration: '40m', type: 'video', completed: true, locked: false },
      { id: 'm3', title: 'S-Scan Interpretation', duration: '35m', type: 'video', completed: true, locked: false },
      { id: 'm4', title: 'TOFD Principles', duration: '30m', type: 'video', completed: true, locked: false },
      { id: 'm5', title: 'Mid-Course Assessment', duration: '15m', type: 'quiz', completed: true, locked: false },
      { id: 'm6', title: 'Corrosion Mapping Setup', duration: '45m', type: 'video', completed: false, locked: false },
      { id: 'm7', title: 'Field Application Exercise', duration: '60m', type: 'practical', completed: false, locked: true },
      { id: 'm8', title: 'Final Certification Quiz', duration: '20m', type: 'quiz', completed: false, locked: true },
    ],
    tags: ['PAUT', 'TOFD', 'corrosion mapping', 'UT Level II'],
  },
  {
    id: 'crs-002',
    title: 'Safety Essentials Refresh',
    subtitle: 'H₂S, Confined Space & Hot Work Permits',
    instructor: 'Eng. Sarah Mitchell',
    duration: '2h 15m',
    totalModules: 6,
    completedModules: 6,
    progress: 100,
    category: 'safety',
    difficulty: 'beginner',
    thumbnailIcon: 'shield-checkmark-outline',
    accentColor: '#FDCB6E',
    description:
      'Mandatory annual safety refresher covering H₂S awareness, confined space entry procedures, hot work permits, LOTO protocols, and emergency response. Aligned with OSHA 29 CFR 1910 and client-specific HSE requirements.',
    modules: [
      { id: 'm1', title: 'H₂S Awareness', duration: '20m', type: 'video', completed: true, locked: false },
      { id: 'm2', title: 'Confined Space Entry', duration: '25m', type: 'video', completed: true, locked: false },
      { id: 'm3', title: 'Hot Work Procedures', duration: '20m', type: 'video', completed: true, locked: false },
      { id: 'm4', title: 'LOTO Protocols', duration: '15m', type: 'reading', completed: true, locked: false },
      { id: 'm5', title: 'Emergency Response Drill', duration: '30m', type: 'practical', completed: true, locked: false },
      { id: 'm6', title: 'Safety Certification Quiz', duration: '25m', type: 'quiz', completed: true, locked: false },
    ],
    tags: ['H2S', 'confined space', 'hot work', 'LOTO', 'OSHA'],
  },
  {
    id: 'crs-003',
    title: 'API 570 Exam Prep',
    subtitle: 'Complete Body of Knowledge Review',
    instructor: 'James Harrington, API 570/510',
    duration: '12h 00m',
    totalModules: 15,
    completedModules: 3,
    progress: 20,
    category: 'codes',
    difficulty: 'advanced',
    thumbnailIcon: 'book-outline',
    accentColor: '#FF6B35',
    description:
      'Comprehensive preparation for the API 570 Piping Inspector certification exam. Covers the full body of knowledge including API 570, API 574, API 571, ASME B31.3, ASME Section V, and ASME Section IX with practice questions and timed mock exams.',
    modules: [
      { id: 'm1', title: 'API 570 Scope & Definitions', duration: '45m', type: 'video', completed: true, locked: false },
      { id: 'm2', title: 'Owner/Operator Responsibilities', duration: '30m', type: 'reading', completed: true, locked: false },
      { id: 'm3', title: 'Inspection Planning', duration: '50m', type: 'video', completed: true, locked: false },
      { id: 'm4', title: 'Thickness Calculations', duration: '60m', type: 'video', completed: false, locked: false },
      { id: 'm5', title: 'Practice Problems Set 1', duration: '30m', type: 'quiz', completed: false, locked: false },
      { id: 'm6', title: 'Repair & Alteration', duration: '45m', type: 'video', completed: false, locked: true },
      { id: 'm7', title: 'ASME B31.3 Essentials', duration: '60m', type: 'video', completed: false, locked: true },
      { id: 'm8', title: 'ASME Section V NDE', duration: '55m', type: 'video', completed: false, locked: true },
      { id: 'm9', title: 'ASME Section IX Welding', duration: '50m', type: 'video', completed: false, locked: true },
      { id: 'm10', title: 'API 571 Damage Mechanisms', duration: '60m', type: 'video', completed: false, locked: true },
      { id: 'm11', title: 'Practice Problems Set 2', duration: '30m', type: 'quiz', completed: false, locked: true },
      { id: 'm12', title: 'Exam Strategy & Tips', duration: '20m', type: 'reading', completed: false, locked: true },
      { id: 'm13', title: 'Mock Exam 1', duration: '120m', type: 'quiz', completed: false, locked: true },
      { id: 'm14', title: 'Mock Exam Review', duration: '45m', type: 'video', completed: false, locked: true },
      { id: 'm15', title: 'Mock Exam 2', duration: '120m', type: 'quiz', completed: false, locked: true },
    ],
    tags: ['API 570', 'certification', 'exam prep', 'piping'],
  },
  {
    id: 'crs-004',
    title: 'Corrosion Mechanisms 101',
    subtitle: 'Understanding Degradation in Refining',
    instructor: 'Dr. Fatima Zayed, NACE CIP-2',
    duration: '3h 45m',
    totalModules: 7,
    completedModules: 0,
    progress: 0,
    category: 'corrosion',
    difficulty: 'intermediate',
    thumbnailIcon: 'flame-outline',
    accentColor: '#FF4C6E',
    description:
      'Understand the root causes, appearance, and mitigation strategies for the most common damage mechanisms in the refining industry per API 571. Covers sulfidation, naphthenic acid corrosion, CUI, chloride SCC, hydrogen damage, and more.',
    modules: [
      { id: 'm1', title: 'Introduction to Damage Mechanisms', duration: '25m', type: 'video', completed: false, locked: false },
      { id: 'm2', title: 'Uniform & Localized Corrosion', duration: '35m', type: 'video', completed: false, locked: false },
      { id: 'm3', title: 'High-Temperature Mechanisms', duration: '40m', type: 'video', completed: false, locked: true },
      { id: 'm4', title: 'Environmental Cracking', duration: '35m', type: 'video', completed: false, locked: true },
      { id: 'm5', title: 'Hydrogen-Related Damage', duration: '30m', type: 'video', completed: false, locked: true },
      { id: 'm6', title: 'Case Study Analysis', duration: '40m', type: 'reading', completed: false, locked: true },
      { id: 'm7', title: 'Knowledge Check', duration: '20m', type: 'quiz', completed: false, locked: true },
    ],
    tags: ['corrosion', 'API 571', 'damage mechanisms', 'refining'],
  },
  {
    id: 'crs-005',
    title: 'Digital Inspection Tools',
    subtitle: 'NEXPEC Platform Mastery',
    instructor: 'NEXPEC Training Team',
    duration: '1h 30m',
    totalModules: 5,
    completedModules: 2,
    progress: 40,
    category: 'digital',
    difficulty: 'beginner',
    thumbnailIcon: 'phone-portrait-outline',
    accentColor: '#6C5CE7',
    description:
      'Learn to maximize your efficiency with the NEXPEC digital inspection platform. Master field data capture, photo documentation, defect annotation, report generation, and offline sync capabilities.',
    modules: [
      { id: 'm1', title: 'NEXPEC Overview & Setup', duration: '15m', type: 'video', completed: true, locked: false },
      { id: 'm2', title: 'Field Data Capture', duration: '20m', type: 'video', completed: true, locked: false },
      { id: 'm3', title: 'Photo & Defect Annotation', duration: '25m', type: 'video', completed: false, locked: false },
      { id: 'm4', title: 'Report Generation', duration: '15m', type: 'video', completed: false, locked: false },
      { id: 'm5', title: 'Offline Sync & Troubleshooting', duration: '15m', type: 'reading', completed: false, locked: true },
    ],
    tags: ['NEXPEC', 'digital', 'mobile', 'reports'],
  },
  {
    id: 'crs-006',
    title: 'Weld Inspection Masterclass',
    subtitle: 'Visual, MT, PT & Acceptance Criteria',
    instructor: 'Robert Chen, CWI/CWE',
    duration: '5h 00m',
    totalModules: 10,
    completedModules: 7,
    progress: 75,
    category: 'practical',
    difficulty: 'intermediate',
    thumbnailIcon: 'construct-outline',
    accentColor: '#00B894',
    description:
      'Comprehensive weld inspection training covering visual examination techniques, magnetic particle and liquid penetrant testing of welds, weld defect identification, acceptance criteria per AWS D1.1, ASME Section IX, and API 1104.',
    modules: [
      { id: 'm1', title: 'Weld Joint Types & Symbols', duration: '25m', type: 'video', completed: true, locked: false },
      { id: 'm2', title: 'WPS/PQR/WPQ Review', duration: '30m', type: 'reading', completed: true, locked: false },
      { id: 'm3', title: 'Visual Inspection Techniques', duration: '35m', type: 'video', completed: true, locked: false },
      { id: 'm4', title: 'Common Weld Defects Gallery', duration: '40m', type: 'video', completed: true, locked: false },
      { id: 'm5', title: 'MT Examination on Welds', duration: '30m', type: 'video', completed: true, locked: false },
      { id: 'm6', title: 'PT Examination on Welds', duration: '25m', type: 'video', completed: true, locked: false },
      { id: 'm7', title: 'Acceptance Criteria Workshop', duration: '45m', type: 'practical', completed: true, locked: false },
      { id: 'm8', title: 'Field Simulation Exercise', duration: '50m', type: 'practical', completed: false, locked: false },
      { id: 'm9', title: 'Defect Disposition & Reporting', duration: '30m', type: 'video', completed: false, locked: false },
      { id: 'm10', title: 'Final Assessment', duration: '30m', type: 'quiz', completed: false, locked: true },
    ],
    tags: ['welding', 'VT', 'MT', 'PT', 'CWI', 'defects'],
  },
];

export const CATEGORY_META: Record<Course['category'], { label: string; icon: string; color: string }> = {
  nde: { label: 'NDE Methods', icon: 'radio-outline', color: '#00CEC9' },
  safety: { label: 'Safety', icon: 'shield-checkmark-outline', color: '#FDCB6E' },
  codes: { label: 'Codes & Standards', icon: 'book-outline', color: '#FF6B35' },
  corrosion: { label: 'Corrosion', icon: 'flame-outline', color: '#FF4C6E' },
  practical: { label: 'Practical Skills', icon: 'construct-outline', color: '#00B894' },
  digital: { label: 'Digital Tools', icon: 'phone-portrait-outline', color: '#6C5CE7' },
};

export const DIFFICULTY_META: Record<Course['difficulty'], { label: string; color: string }> = {
  beginner: { label: 'Beginner', color: '#00B894' },
  intermediate: { label: 'Intermediate', color: '#FDCB6E' },
  advanced: { label: 'Advanced', color: '#FF4C6E' },
};