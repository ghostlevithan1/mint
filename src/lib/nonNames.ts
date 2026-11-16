/**
 * Words that show a run of capitalised words is a thing, not a person.
 *
 * Name detection treats two or three capitalised words in a row as a full
 * name. On its own that also catches "French Revolution", "Cold War" and
 * "New York", and every one of those would reach the model as [PERSON_01],
 * breaking the explanation it was asked for. These lists reject such spans.
 *
 * They only ever stop a span from being treated as a name; a real name is
 * never added here. Words that are also common given names or surnames
 * (May, June, Grace, Black, Hill, Green) are left out on purpose.
 */

/** Words that mark an event, place, law, idea, work or date, wherever they sit in the span. */
export const TOPIC_WORDS = new Set([
  // History and politics
  'revolution', 'revolutions', 'war', 'wars', 'empire', 'empires', 'dynasty', 'kingdom',
  'republic', 'union', 'states', 'treaty', 'declaration', 'constitution', 'charter', 'act',
  'accord', 'pact', 'battle', 'siege', 'crusade', 'crusades', 'movement', 'era', 'age',
  'renaissance', 'reformation', 'enlightenment', 'depression', 'deal', 'death', 'plague',
  'spring', 'parliament', 'congress', 'senate', 'council', 'party', 'army', 'navy',
  'government', 'monarchy', 'colony', 'colonies', 'rebellion', 'uprising', 'massacre',
  'conquest', 'invasion', 'blitz', 'holocaust', 'apartheid', 'independence', 'rights',
  // Science and maths
  'theorem', 'theory', 'laws', 'principle', 'equation', 'equations', 'formula',
  'constant', 'effect', 'paradox', 'hypothesis', 'model', 'cycle', 'selection', 'relativity',
  'mechanics', 'physics', 'chemistry', 'biology', 'science', 'sciences', 'mathematics',
  'maths', 'math', 'algebra', 'geometry', 'calculus', 'statistics', 'table', 'change',
  'respiration', 'photosynthesis', 'evolution', 'system', 'method', 'scale', 'number',
  'numbers', 'sequence', 'triangle', 'reaction', 'acid', 'cell', 'cells',
  // Subjects, school and study
  'history', 'geography', 'literature', 'language', 'languages', 'english', 'studies',
  'year', 'term', 'semester', 'exam', 'exams', 'test', 'quiz', 'chapter', 'unit', 'lesson',
  'module', 'paper', 'papers', 'coursework', 'homework', 'revision', 'gcse', 'gcses',
  'level', 'levels', 'grade', 'class', 'school', 'college', 'academy', 'curriculum',
  'stage', 'holiday', 'holidays', 'vacation', 'break', 'mocks', 'syllabus', 'specification',
  // Works, documents and art
  'book', 'novel', 'play', 'poem', 'farm', 'edition', 'volume', 'bible', 'quran', 'carta',
  'manifesto', 'symphony', 'opera', 'sonata', 'painting',   // Places and geography
  'ocean', 'sea', 'seas', 'desert', 'lake', 'lakes', 'mountain', 'mountains',
  'mount', 'rainforest', 'forest', 'valley', 'island', 'islands', 'peninsula', 'canal',
  'gulf', 'coast', 'continent', 'road', 'street', 'avenue', 'bridge', 'wall',
  'tower', 'palace', 'cathedral', 'chapel', 'mosque', 'abbey',
  'museum', 'gallery', 'square', 'station', 'airport', 'hospital', 'zoo', 'city',
  'county', 'province', 'region', 'district', 'europe', 'africa', 'america', 'americas',
  'antarctica', 'arabia', 'egypt', 'greece', 'italy', 'spain', 'france', 'germany',
  'england', 'britain', 'scotland', 'wales', 'ireland', 'china', 'japan',
  'russia', 'korea', 'canada', 'mexico', 'brazil', 'angeles', 'zealand', 'lanka',
  'kong', 'east', 'emirates', 'pole', 'hemisphere', 'equator', 'tropics', 'everest',
  'sahara', 'amazon', 'nile', 'thames', 'alps', 'himalayas', 'pacific', 'atlantic',
  'falls', 'harbor', 'harbour', 'port', 'reef', 'plate', 'plates', 'volcano', 'glacier',
  'canyon', 'cave', 'caves', 'strait', 'channel', 'basin', 'delta', 'plateau', 'ridge',
  'trench', 'fault',
  // Dates and festivals
  'days', 'week', 'christmas', 'easter', 'ramadan', 'eid', 'diwali',
  'halloween', 'hanukkah', 'thanksgiving', 'sunday', 'monday', 'tuesday', 'wednesday',
  'thursday', 'friday', 'saturday', 'january', 'february', 'september', 'october',
  'november', 'december',
])

/** Words that never begin a person's name, though they often begin a topic. */
export const NON_NAME_FIRST_WORDS = new Set([
  'french', 'british', 'american', 'roman', 'greek', 'ottoman', 'russian', 'chinese',
  'japanese', 'german', 'spanish', 'italian', 'persian', 'mughal', 'egyptian', 'islamic',
  'arab', 'viking', 'norman', 'tudor', 'victorian', 'medieval', 'ancient', 'modern',
  'western', 'eastern', 'northern', 'southern', 'central', 'middle', 'holy', 'great',
  'grand', 'cold', 'civil', 'first', 'second', 'third', 'world', 'industrial', 'natural',
  'general', 'special', 'quantum', 'big', 'new', 'old', 'periodic', 'supreme', 'european',
  'united', 'saudi', 'south', 'north', 'west', 'los', 'las', 'san', 'santa', 'sri', 'hong',
  'pythagorean', 'newtonian', 'atlantic', 'pacific', 'arctic', 'antarctic', 'indian',
  'african', 'asian', 'latin', 'cellular', 'organic', 'nuclear', 'solar', 'lunar', 'animal',
  'human', 'social', 'global', 'national', 'international', 'federal', 'royal', 'imperial',
  'soviet', 'nazi', 'communist', 'democratic', 'republican', 'labour', 'conservative',
  'black', 'golden', 'iron', 'bronze', 'stone', 'ice', 'magna', 'lake', 'mount', 'year',
  'gross', 'tectonic',
  // Software and services students mention
  'microsoft', 'adobe', 'youtube', 'instagram', 'tiktok', 'snapchat', 'whatsapp',
  'spotify', 'netflix', 'minecraft', 'roblox', 'duolingo', 'quizlet', 'kahoot',
])

/** Instructions at the start of a sentence: "Compare Photosynthesis", "Ask Priya Nair". */
export const LEADING_VERBS = new Set([
  'compare', 'contrast', 'discuss', 'define', 'calculate', 'solve', 'revise', 'quiz',
  'plan', 'analyse', 'analyze', 'evaluate', 'outline', 'translate', 'draw', 'graph', 'plot',
  'teach', 'learn', 'read', 'study', 'practise', 'practice', 'simplify', 'prove', 'convert',
  'rewrite', 'fix', 'edit', 'correct', 'label', 'sketch', 'test', 'assess', 'remind',
  'summarise', 'summarize', 'explain', 'describe', 'share', 'show', 'give', 'list', 'find',
  'email', 'message', 'text', 'thank', 'meet', 'invite', 'tell', 'ask', 'call',
  'dear', 'hi', 'hello', 'hey', 'thanks',
])

/** Determiners that put a thing, not a person, in front of a name-shaped span. */
export const TOPIC_DETERMINERS = /(?:^|[^\p{L}])(?:the|a|an|this|that|these|those)\s+$/iu

/** "Ohm’s" → "ohm", "Al-Zahra" → "al-zahra": a word as the lists above spell it. */
export function plainWord(word: string): string {
  return word.toLowerCase().replace(/['’]s$/u, '').replace(/[.,;:!?]+$/u, '')
}
