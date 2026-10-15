// Planner: automatic weeks, event cards and the Planner layout. Spanish key; [es, en, pt].
export const ROWS_PLANNER: [string, string, string][] = [
  // the layout card (one line each: server/test/display-layouts.test.js looks for the whole row)
  ['Planificador', 'Planner', 'Planeador'],
  ['Para familias con muchas citas: el mes con tarjetas que llenan cada día, y el reloj, la fecha y el tiempo arriba. En pantallas horizontales también pueden ir al lado o abajo.', 'For busy families: the month with cards that fill each day, with the clock, the date and the weather on top. On landscape screens they can also go at the side or at the bottom.', 'Para famílias com muitos compromissos: o mês com cartões que enchem cada dia, com o relógio, a data e o tempo em cima. Em ecrãs horizontais também podem ficar ao lado ou em baixo.'],
  [
    'Al elegirlo se activan las semanas automáticas y las tarjetas. Puedes cambiarlo aquí o en Calendarios, Vista del calendario.',
    'Picking it turns on automatic weeks and cards. You can change them here or in Calendars, Calendar view.',
    'Ao escolhê-lo ativam-se as semanas automáticas e os cartões. Podes mudá-los aqui ou em Calendários, Vista do calendário.',
  ],
  [
    'Auto elige entre 2 y 6 semanas, las que caben con el máximo de eventos por día a buen tamaño. Se recalcula si la pantalla gira.',
    'Auto picks 2 to 6 weeks, as many as fit with the most events per day at a good size. It is worked out again when the screen turns.',
    'Auto escolhe entre 2 e 6 semanas, as que cabem com o máximo de eventos por dia num bom tamanho. É recalculado se o ecrã rodar.',
  ],
  [
    'Auto elige entre 2 y 4 semanas, las que caben con el máximo de eventos por día a buen tamaño. Con la hora y el tiempo arriba o abajo no caben más.',
    'Auto picks 2 to 4 weeks, as many as fit with the most events per day at a good size. With the time and the weather at the top or the bottom, no more fit.',
    'Auto escolhe entre 2 e 4 semanas, as que cabem com o máximo de eventos por dia num bom tamanho. Com a hora e o tempo em cima ou em baixo não cabem mais.',
  ],
  // where the clock and the weather go on a landscape screen (layout.plannerBar)
  ['Hora y tiempo', 'Time and weather', 'Hora e tempo'],
  ['Al lado', 'At the side', 'Ao lado'],
  ['Arriba', 'Top', 'Em cima'],
  ['Abajo', 'Bottom', 'Em baixo'],
  [
    'En pantallas horizontales. Arriba o abajo, el mes ocupa todo el ancho y el tiempo se ve en una fila. En vertical siempre van arriba.',
    'On landscape screens. At the top or the bottom, the month takes the whole width and the weather is shown in one row. On portrait screens they are always on top.',
    'Em ecrãs horizontais. Em cima ou em baixo, o mês ocupa toda a largura e o tempo aparece numa linha. Na vertical ficam sempre em cima.',
  ],
  [
    'Con la hora y el tiempo arriba o abajo se ven como mucho 4 semanas.',
    'With the time and the weather at the top or the bottom, at most 4 weeks are shown.',
    'Com a hora e o tempo em cima ou em baixo, veem-se no máximo 4 semanas.',
  ],
  [
    'El Planificador tiene ahora la hora y el tiempo arriba o abajo, sin columna lateral.',
    'The Planner now has the time and the weather at the top or the bottom, with no side column.',
    'O Planeador tem agora a hora e o tempo em cima ou em baixo, sem coluna lateral.',
  ],
  ['Estilo de los eventos', 'Event style', 'Estilo dos eventos'],
  ['Líneas', 'Lines', 'Linhas'],
  ['Tarjetas', 'Cards', 'Cartões'],
  [
    'Tarjetas: la hora arriba y el título debajo, en hasta dos líneas, una tras otra en cada día. Los eventos de varios días siguen siendo barras.',
    'Cards: the time on top and the title below on up to two lines, one after another in each day. Events of several days stay as bars.',
    'Cartões: a hora em cima e o título por baixo, em até duas linhas, uns a seguir aos outros em cada dia. Os eventos de vários dias continuam a ser barras.',
  ],
  [
    'Líneas: cada evento en una línea, con la hora delante.',
    'Lines: each event on one line, with the time in front.',
    'Linhas: cada evento numa linha, com a hora à frente.',
  ],
  [
    'Con tarjetas, cada día muestra las que caben en su alto. Este número cuenta para elegir las semanas en Auto.',
    'With cards, each day shows as many as fit in its height. This number is used to pick the weeks with Auto.',
    'Com cartões, cada dia mostra os que cabem na sua altura. Este número conta para escolher as semanas em Auto.',
  ],
  [
    'Con el estilo de tarjetas no se usa: las tarjetas ya se apilan en cada día.',
    'Not used with the cards style: cards already stack up in each day.',
    'Não se usa com o estilo de cartões: os cartões já se empilham em cada dia.',
  ],
  // cards of a busy day drawn smaller (calendar.fitBusyDays)
  ['Encoger las tarjetas de los días llenos', 'Shrink the cards of busy days', 'Encolher os cartões dos dias cheios'],
  [
    'Si en un día no caben todas las tarjetas, se dibujan más pequeñas (hasta un 60 %) para que se vean todas a la vez. Lo que aun así no cabe se muestra por turnos o con “+N”.',
    'If a day cannot fit all its cards, they are drawn smaller (down to 60%) so they all show at once. What still does not fit is shown in turns or as “+N”.',
    'Se num dia não cabem todos os cartões, são desenhados mais pequenos (até 60 %) para se verem todos ao mesmo tempo. O que mesmo assim não cabe aparece por turnos ou com “+N”.',
  ],
  ['Solo con el estilo de tarjetas.', 'Only with the cards style.', 'Só com o estilo de cartões.'],
  // how far the agenda view looks ahead (calendar.agendaDays)
  ['Días en la agenda', 'Days in the agenda', 'Dias na agenda'],
  [
    'Automático: hoy y mañana, y después los próximos días con eventos hasta llenar la agenda. Nunca muestra menos de lo que mostraría con 14.',
    'Automatic: today and tomorrow, then the next days with events until the agenda is full. It never shows less than 14 days would.',
    'Automático: hoje e amanhã e, depois, os próximos dias com eventos até encher a agenda. Nunca mostra menos do que mostraria com 14.',
  ],
  [
    'La agenda muestra los próximos {n} días. Los días sin eventos no ocupan sitio.',
    'The agenda shows the next {n} days. Days without events take no room.',
    'A agenda mostra os próximos {n} dias. Os dias sem eventos não ocupam espaço.',
  ],
  // calendar.startOn: the grid starts on Monday, Sunday or today
  ['El calendario empieza en', 'Calendar starts on', 'O calendário começa em'],
  [
    'Sin días pasados: el calendario empieza siempre por hoy y avanza un día cada medianoche.',
    'No past days: the calendar always starts with today and moves on by one day at midnight.',
    'Sem dias passados: o calendário começa sempre no dia de hoje e avança um dia à meia-noite.',
  ],
];
