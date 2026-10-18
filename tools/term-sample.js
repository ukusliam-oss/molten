// Made-up Term data for public screenshots: invented subjects, rooms and times.
// Injected at document start, before Term reads localStorage. Also pins the clock
// to a Tuesday mid-morning so the Today view shows a lesson in progress.
(() => {
  const RealDate = Date;
  const fixed = new RealDate('2026-10-20T10:20:00').getTime();
  const t0 = RealDate.now();
  class PinnedDate extends RealDate {
    constructor(...a) { super(...(a.length ? a : [fixed + (RealDate.now() - t0)])); }
    static now() { return fixed + (RealDate.now() - t0); }
  }
  globalThis.Date = PinnedDate;

  const subjects = [
    ['maths', 'Maths', 'Ma', 'M4', 'blue'], ['english', 'English', 'En', 'E2', 'red'],
    ['physics', 'Physics', 'Ph', 'S7', 'indigo'], ['chem', 'Chemistry', 'Ch', 'S3', 'green'],
    ['history', 'History', 'Hi', 'H1', 'orange'], ['econ', 'Economics', 'Ec', 'B5', 'teal'],
    ['art', 'Art', 'Ar', 'A2', 'pink'], ['cs', 'Computer Science', 'CS', 'C1', 'purple'],
  ].map(([id, name, short, room, color]) => ({ id, name, short, room, color, level: 'GCSE', teacher: '', kit: [], kind: 'academic' }));
  const periods = [
    { id: 'reg', label: 'Registration', start: '08:40', end: '08:55', kind: 'reg' },
    { id: 'p1', label: 'P1', start: '09:00', end: '09:55', kind: 'period' },
    { id: 'p2', label: 'P2', start: '10:00', end: '10:55', kind: 'period' },
    { id: 'p3', label: 'P3', start: '11:15', end: '12:10', kind: 'period' },
    { id: 'p4', label: 'P4', start: '12:15', end: '13:10', kind: 'period' },
    { id: 'p5', label: 'P5', start: '14:00', end: '14:55', kind: 'period' },
    { id: 'p6', label: 'P6', start: '15:00', end: '15:55', kind: 'period' },
  ];
  const cells = {};
  const ids = subjects.map(s => s.id);
  ['A', 'B'].forEach((L, li) => {
    for (let dow = 1; dow <= 5; dow++) {
      ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].forEach((p, pi) => {
        cells[`${L}${dow}-${p}`] = ids[(dow * 3 + pi * 5 + li * 2) % ids.length];
      });
    }
  });
  const docs = {
    'term/settings': { name: '', school: '', anchorMonday: '2026-10-19', anchorWeek: 'A', pauseOnHolidays: true, accent: 'blue', reduceMotion: false },
    'term/timetable': {
      subjects, periods, cells,
      breaks: [{ start: '10:55', end: '11:15', label: 'Break' }, { start: '13:10', end: '14:00', label: 'Lunch' }],
    },
    'items/h1': { title: 'Simultaneous equations sheet', kind: 'homework', subjectId: 'maths', due: '2026-10-21', status: 'todo' },
    'items/h2': { title: 'Poem comparison essay', kind: 'homework', subjectId: 'english', due: '2026-10-23', status: 'todo' },
    'items/t1': { title: 'Forces and motion', kind: 'assessment', type: 'Test', subjectId: 'physics', due: '2026-10-27', status: 'todo' },
  };
  try { localStorage.setItem('term.local.v1', JSON.stringify(docs)); } catch {}
})();
