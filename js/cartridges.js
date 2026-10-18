// What the console can play, and the two pages that aren't cartridges (about, contact).
// Every fact is measured and public-safe: no name, school, timetable or borrowed assets.
// Screens are real renders: Folio's offscreen probe on its made-up library, Term's live site
// with invented sample data. `crop` is the part of each image the console's pixel screen shows.

export const HANDLE = 'ukusliam-oss';
export const GITHUB = `https://github.com/${HANDLE}`;

export const HOME = {
  heavy: 'Mol', script: 'ten',
  line: 'A CONSOLE FOR THE THINGS I MAKE.',
  left: '← →  PICK A CARTRIDGE',
  right: 'MOVE TO STIR',
};

export const ABOUT = {
  heavy: 'Ab', script: 'out',
  line: 'I BUILD THE TOOLS I USE EVERY DAY.',
  facts: ['8 PROJECTS', '5 NATIVE MAC APPS', 'SWIFT · JS · GODOT', '3 ON DISPLAY'],
  left: `@${HANDLE.toUpperCase()}`,
  right: 'STIR TO READ · B TO FLIP BACK',
};

export const CONTACT = {
  heavy: 'Hel', script: 'lo',
  line: 'THE QUICKEST WAY TO REACH ME IS GITHUB.',
  facts: ['GITHUB.COM', `/${HANDLE.toUpperCase()}`, 'SAY HI', 'A TO OPEN'],
  left: 'CONTACT',
  right: 'A TO OPEN GITHUB · B BACK',
};

export const CARTRIDGES = [
  {
    id: 'folio', name: 'Folio', heavy: 'Fol', script: 'io', kind: 'MAC APP',
    color: '#3156d3', screen: '#0f1733',
    line: 'MY BOOKS, PDFS AND LESSONS ON ONE SHELF, BROWSED LIKE A TV.',
    facts: ['91 COMMITS', 'NO THIRD-PARTY CODE', 'CARD → PAGE IN 0.3 S', 'SEARCH BY MEANING'],
    story: 'I wanted my books, PDFs and lesson slides on one shelf, opened the way a TV app opens a film: big cards, arrow keys, no hunting with the mouse. It is a native Mac app with no third-party code. WebKit and PDFKit draw the pages, and a search index finds a passage by its words, or by its meaning when the words come up short.',
    shots: [
      { src: 'media/folio-1.jpg', crop: [68, 0, 887, 576], caption: 'A book card, drawn offscreen from a made-up library' },
      { src: 'media/folio-2.jpg', crop: [68, 0, 887, 576], caption: 'A course of lesson slides' },
    ],
    url: null, repo: null,
  },
  {
    id: 'term', name: 'Term', heavy: 'Te', script: 'rm', kind: 'WEB APP',
    color: '#e2483d', screen: '#2a0f0d',
    line: 'A SCHOOL PLANNER THAT KNOWS WHICH WEEK IT IS.',
    facts: ['A/B FORTNIGHT', 'INSTALLS LIKE AN APP', 'NO BUILD STEP', 'WORKS OFFLINE'],
    story: 'My timetable runs on a two-week A/B cycle, and no planner I tried knew which week it was. Term does: it says what is on now, what is next and what is due, and it installs to a phone’s home screen like an app. Plain JavaScript, no build step, and it keeps working offline. The screens here use invented sample data.',
    shots: [
      { src: 'media/term-1.jpg', crop: [0, 80, 780, 506], caption: 'Today: the lesson on now and what is due' },
      { src: 'media/term-2.jpg', crop: [0, 760, 780, 506], caption: 'The A/B timetable, one day at a time' },
      { src: 'media/term-3.jpg', crop: [0, 1000, 780, 506], caption: 'The planner counting down to the next test' },
    ],
    url: 'https://ukusliam-oss.github.io/term/', repo: `${HANDLE}/term`,
  },
  {
    id: 'threshold', name: 'Threshold', heavy: 'Thresh', script: 'old', kind: 'MAC APP',
    color: '#1f9d6b', screen: '#0b2219',
    line: 'PAST PAPERS, SPLIT INTO QUESTIONS AND SORTED BY TOPIC.',
    facts: ['294 QUESTIONS', '14 PAPERS SPLIT', 'TAGGED ON-DEVICE', 'PDFKIT · VISION'],
    story: 'Past papers are the best revision there is, but they arrive as hundreds of PDFs. Threshold splits each paper into its questions with their marks, tags every question by topic with the Mac’s on-device model, and ranks the topics by priority. The papers themselves belong to the exam board, so there are no screenshots here.',
    shots: [],
    url: null, repo: null,
  },
];
CARTRIDGES.forEach((cart, i) => { cart.index = i; });
