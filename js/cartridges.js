// What the console can play. Copy is a first draft taken from each project's CLAUDE.md;
// facts must stay measured and public-safe (no name, school, timetable or borrowed assets).

export const HOME = {
  heavy: 'Mol', script: 'ten',
  line: 'A CONSOLE FOR THE THINGS I MAKE.',
  left: '← →  PICK A CARTRIDGE',
  right: 'MOVE TO STIR',
};

export const CARTRIDGES = [
  {
    id: 'folio', name: 'Folio', heavy: 'Fol', script: 'io', kind: 'MAC APP',
    color: '#3156d3', screen: '#0f1733',
    line: 'A READING APP FOR MY OWN LIBRARY — EPUB, PDF, TEXT.',
    facts: ['91 COMMITS', 'ZERO DEPENDENCIES', 'WEBKIT · PDFKIT · METAL', 'A TV APP ON A MAC'],
    url: null,
  },
  {
    id: 'term', name: 'Term', heavy: 'Te', script: 'rm', kind: 'WEB APP',
    color: '#e2483d', screen: '#2a0f0d',
    line: 'A SCHOOL PLANNER: A/B TIMETABLE, HOMEWORK, TESTS.',
    facts: ['A/B FORTNIGHT', 'INSTALLS LIKE AN APP', 'NO BUILD STEP', 'WORKS OFFLINE'],
    url: 'https://ukusliam-oss.github.io/term/',
  },
  {
    id: 'threshold', name: 'Threshold', heavy: 'Thresh', script: 'old', kind: 'MAC APP',
    color: '#1f9d6b', screen: '#0b2219',
    line: 'PAST PAPERS, INDEXED QUESTION BY QUESTION.',
    facts: ['294 QUESTIONS', '14 PAPERS INDEXED', 'PDFKIT · VISION', 'ON-DEVICE AI'],
    url: null,
  },
];
