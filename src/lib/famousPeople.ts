/**
 * Well-known historical and public figures that the PII shield lets through.
 *
 * Hiding "Napoleon" or "Marie Curie" protects nobody and leaves a tutor unable
 * to answer "Why did [PERSON_01] write Macbeth?". These names are let through
 * only when they read as the figure: a title or an introduction in front
 * ("Mr Newton", "my friend Charles Darwin", "my name is Albert Einstein")
 * still hides them, because then it is someone the student knows.
 *
 * Names shared by many living people are left out on purpose even when the
 * figure is famous (Muhammad Ali, John Smith, James Cook): for them the
 * shield cannot tell the figure from a classmate, so it keeps hiding them.
 *
 * Entries are written in the form figureKey() produces: lowercase, no accents,
 * no full stops, hyphens as spaces, "Jr"/"Sr" dropped.
 */

/** Full names and the usual short forms. Matched as whole phrases. */
export const FAMOUS_FULL_NAMES = new Set([
  // Ancient and classical
  'julius caesar', 'augustus caesar', 'mark antony', 'alexander the great', 'hannibal barca',
  'genghis khan', 'kublai khan', 'attila the hun', 'ramesses ii', 'king tut', 'queen nefertiti',
  'boudicca', 'spartacus', 'cleopatra', 'queen cleopatra', 'tutankhamun', 'nero', 'caligula', 'marcus aurelius', 'constantine the great',
  'confucius', 'sun tzu', 'siddhartha gautama', 'the buddha', 'jesus christ', 'pontius pilate',
  // Medieval and early modern
  'william the conqueror', 'king harold', 'harold godwinson', 'richard the lionheart',
  'king john', 'joan of arc', 'charlemagne', 'saladin', 'salah ad din', 'mansa musa',
  'marco polo', 'ibn battuta', 'ibn sina', 'ibn khaldun', 'al khwarizmi', 'avicenna', 'averroes',
  'suleiman the magnificent', 'mehmed the conqueror', 'christopher columbus', 'vasco da gama',
  'ferdinand magellan', 'hernan cortes', 'francisco pizarro', 'martin luther', 'john calvin',
  'henry viii', 'king henry viii', 'henry the eighth', 'anne boleyn', 'catherine of aragon',
  'jane seymour', 'thomas cromwell', 'thomas more', 'elizabeth i', 'queen elizabeth i',
  'mary queen of scots', 'bloody mary', 'richard iii', 'king richard iii', 'guy fawkes',
  'oliver cromwell', 'charles i', 'king charles i', 'james i', 'walter raleigh', 'francis drake',
  'ivan the terrible', 'peter the great', 'catherine the great', 'louis xiv', 'louis xvi',
  'marie antoinette', 'maximilien robespierre', 'robespierre', 'napoleon bonaparte',
  'napoleon', 'the duke of wellington', 'horatio nelson', 'admiral nelson', 'captain cook',
  'george washington', 'thomas jefferson', 'benjamin franklin', 'alexander hamilton',
  'john adams', 'simon bolivar',
  // 19th and 20th century politics and history
  'queen victoria', 'prince albert', 'abraham lincoln', 'ulysses s grant', 'robert e lee',
  'otto von bismarck', 'bismarck', 'karl marx', 'friedrich engels', 'vladimir lenin', 'lenin',
  'leon trotsky', 'trotsky', 'joseph stalin', 'stalin', 'adolf hitler', 'hitler',
  'benito mussolini', 'mussolini', 'heinrich himmler', 'joseph goebbels', 'hermann goring',
  'winston churchill', 'neville chamberlain', 'clement attlee', 'franklin roosevelt',
  'franklin d roosevelt', 'theodore roosevelt', 'woodrow wilson', 'harry truman',
  'dwight eisenhower', 'john f kennedy', 'jfk', 'lyndon johnson', 'richard nixon',
  'ronald reagan', 'margaret thatcher', 'mikhail gorbachev', 'gorbachev', 'nikita khrushchev',
  'khrushchev', 'mao zedong', 'mao tse tung', 'chairman mao', 'chiang kai shek', 'deng xiaoping',
  'ho chi minh', 'pol pot', 'fidel castro', 'che guevara', 'kaiser wilhelm', 'wilhelm ii',
  'tsar nicholas ii', 'nicholas ii', 'rasputin', 'emperor hirohito', 'hirohito',
  'charles de gaulle', 'mahatma gandhi', 'jawaharlal nehru', 'muhammad ali jinnah',
  'nelson mandela', 'desmond tutu', 'kwame nkrumah', 'haile selassie',
  'jomo kenyatta', 'patrice lumumba', 'gamal abdel nasser', 'anwar sadat', 'ataturk',
  'mustafa kemal ataturk', 'golda meir', 'david ben gurion', 'yasser arafat',
  'martin luther king', 'mlk', 'malcolm x', 'rosa parks', 'harriet tubman', 'frederick douglass',
  'sojourner truth', 'emmeline pankhurst', 'emily davison', 'emily wilding davison',
  'millicent fawcett', 'susan b anthony', 'elizabeth cady stanton', 'anne frank',
  'oskar schindler', 'florence nightingale', 'mary seacole', 'edith cavell', 'queen elizabeth ii',
  'elizabeth ii', 'king charles iii', 'charles iii', 'princess diana', 'princess of wales',
  // Recent and current public figures
  'barack obama', 'obama', 'donald trump', 'joe biden', 'kamala harris', 'hillary clinton',
  'bill clinton', 'george w bush', 'tony blair', 'gordon brown', 'david cameron',
  'theresa may', 'boris johnson', 'rishi sunak', 'keir starmer', 'vladimir putin', 'putin',
  'volodymyr zelensky', 'zelensky', 'xi jinping', 'narendra modi', 'emmanuel macron',
  'angela merkel', 'greta thunberg', 'malala yousafzai', 'elon musk', 'bill gates',
  'steve jobs', 'mark zuckerberg', 'jeff bezos',
  // Science, maths and medicine
  'isaac newton', 'sir isaac newton', 'albert einstein', 'einstein', 'galileo galilei',
  'galileo', 'nicolaus copernicus', 'copernicus', 'johannes kepler', 'kepler', 'tycho brahe',
  'charles darwin', 'alfred russel wallace', 'gregor mendel', 'louis pasteur', 'pasteur',
  'marie curie', 'pierre curie', 'ada lovelace', 'charles babbage', 'alan turing',
  'stephen hawking', 'nikola tesla', 'thomas edison', 'alexander graham bell',
  'michael faraday', 'james clerk maxwell', 'ernest rutherford',   'niels bohr', 'max planck', 'werner heisenberg', 'erwin schrodinger', 'richard feynman',
  'robert oppenheimer', 'j robert oppenheimer', 'enrico fermi', 'dmitri mendeleev',
  'mendeleev', 'john dalton', 'antoine lavoisier', 'robert hooke', 'robert boyle',
  'rosalind franklin', 'francis crick', 'james watson', 'alexander fleming', 'edward jenner',
  'joseph lister', 'john snow', 'william harvey', 'hippocrates', 'andreas vesalius',
  'archimedes', 'pythagoras', 'euclid', 'leonhard euler', 'euler', 'carl friedrich gauss',
  'gauss', 'blaise pascal', 'rene descartes', 'descartes', 'pierre de fermat', 'fermat',
  'srinivasa ramanujan', 'ramanujan', 'leonardo fibonacci', 'fibonacci', 'emmy noether',
  'katherine johnson', 'carl sagan', 'neil armstrong', 'buzz aldrin', 'yuri gagarin',
  'valentina tereshkova', 'jane goodall', 'david attenborough', 'sir david attenborough',
  // Literature, art, music and philosophy
  'william shakespeare', 'shakespeare', 'geoffrey chaucer', 'chaucer', 'john milton',
  'charles dickens', 'jane austen', 'charlotte bronte', 'emily bronte',
  'mary shelley', 'percy shelley', 'lord byron', 'william wordsworth', 'john keats',
  'samuel taylor coleridge', 'william blake', 'robert louis stevenson', 'oscar wilde',
  'thomas hardy', 'arthur conan doyle', 'h g wells', 'george orwell',   'aldous huxley', 'virginia woolf', 'f scott fitzgerald', 'ernest hemingway',
  'john steinbeck', 'harper lee', 'jk rowling', 'j k rowling', 'j r r tolkien', 'tolkien',
  'c s lewis', 'roald dahl', 'agatha christie', 'mark twain', 'edgar allan poe',
  'leo tolstoy', 'tolstoy', 'fyodor dostoevsky', 'dostoevsky', 'victor hugo',   'dante alighieri', 'miguel de cervantes', 'cervantes', 'carol ann duffy',
  'seamus heaney', 'wilfred owen', 'siegfried sassoon', 'rupert brooke', 'maya angelou',
  'toni morrison', 'chinua achebe', 'omar khayyam', 'leonardo da vinci', 'da vinci',
  'michelangelo', 'rembrandt', 'vincent van gogh', 'van gogh', 'claude monet',
  'monet', 'pablo picasso', 'picasso', 'salvador dali', 'frida kahlo', 'andy warhol',
  'banksy', 'wolfgang amadeus mozart', 'mozart', 'ludwig van beethoven', 'beethoven',
  'johann sebastian bach', 'frederic chopin', 'chopin', 'pyotr tchaikovsky', 'tchaikovsky',
  'antonio vivaldi', 'vivaldi', 'george frideric handel', 'handel', 'the beatles',
  'john lennon', 'paul mccartney', 'elvis presley', 'socrates', 'plato', 'aristotle',
  'immanuel kant', 'kant', 'friedrich nietzsche', 'nietzsche', 'jean paul sartre',
  'simone de beauvoir', 'john locke', 'thomas hobbes', 'jean jacques rousseau', 'rousseau',
  'adam smith', 'john maynard keynes', 'keynes', 'niccolo machiavelli', 'machiavelli',
  'sigmund freud', 'freud', 'carl jung', 'ivan pavlov', 'pavlov', 'b f skinner',
  // Sport and culture often set as topics
  'jesse owens', 'pele', 'diego maradona', 'serena williams', 'usain bolt',
])

/** A figure's name in the form FAMOUS_FULL_NAMES uses. */
export function figureKey(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’]s\b/g, '')
    .replace(/[.]/g, '')
    .replace(/[-‐–]/g, ' ')
    .split(/\s+/)
    .filter((word) => word && word !== 'jr' && word !== 'sr')
    .join(' ')
}

/** In front of a name, these make it someone the student knows, not the figure. */
export const KNOWN_PERSON_CONTEXT =
  /(?:^|[^\p{L}])(?:mr|mrs|ms|miss|mx|dr|prof|my name is|i am|i['’]m|call me|my (?:friend|teacher|classmate|tutor|mum|mom|dad|brother|sister|cousin|aunt|uncle|grandma|grandad|grandpa|neighbour|neighbor|boss|partner|coach))\.?,?\s+$/iu
