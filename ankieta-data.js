export const SURVEY = {
  id: "samopoczucie-2-tygodnie",
  eyebrow: "Anonimowa ankieta",
  title: "Ankieta",
  lead:
    "Odpowiedz na kilka krótkich pytań. Wyniki pokazujemy zbiorczo i bez danych osobowych.",
  instruction:
    "Zaznacz odpowiedź, która najlepiej opisuje Twoje samopoczucie w ostatnim czasie.",
  frequencyScale: ["Nigdy", "Rzadko", "Czasami", "Często"],
  sections: [
    {
      id: "czesc-1",
      title: "Pytania o częstotliwość",
      description: "",
      scaleId: "frequency",
      questions: [
        { id: "q1", text: "Jak często czujesz się przygnębiony/a lub smutny/a?" },
        { id: "q2", text: "Jak często odczuwasz spokój i zrelaksowanie?" },
        {
          id: "q3",
          text: "Jak często masz poczucie, że dobrze radzisz sobie z codziennymi problemami?",
        },
        { id: "q4", text: "Jak często czujesz się samotny/a?" },
        {
          id: "q5",
          text: "Jak często czerpiesz radość z rzeczy, które dawniej sprawiały Ci przyjemność?",
        },
        {
          id: "q6",
          text: "Jak często pojawiają się u Ciebie negatywne myśli na swój temat?",
        },
        { id: "q7", text: "Jak często czujesz się przytłoczony/a obowiązkami?" },
        { id: "q8", text: "Jak często odczuwasz trudności z koncentracją?" },
        { id: "q9", text: "Jak często masz poczucie sensu i celu w tym, co robisz?" },
        { id: "q10", text: "Jak często odczuwasz niepokój bez wyraźnego powodu?" },
        {
          id: "q11",
          text: "Jak często masz problemy z zasypianiem lub budzisz się w nocy?",
        },
        {
          id: "q12",
          text: "Jak często odczuwasz brak energii do wykonywania codziennych czynności?",
        },
        { id: "q13", text: "Jak często odczuwasz stres lub napięcie?" },
      ],
    },
    {
      id: "czesc-2",
      title: "Pytania ogólne",
      description: "",
      scaleId: "custom",
      questions: [
        {
          id: "q14",
          text: "Czy czujesz, że masz wsparcie od innych ludzi (rodzina, znajomi)?",
          options: [
            "Zdecydowanie tak",
            "Raczej tak",
            "Trudno powiedzieć",
            "Raczej nie",
            "Zdecydowanie nie",
          ],
        },
        {
          id: "q15",
          text: "Jak oceniasz swoje ogólne samopoczucie psychiczne w ostatnim czasie?",
          options: [
            "Bardzo dobrze",
            "Dobrze",
            "Przeciętnie / Średnio",
            "Źle",
            "Bardzo źle",
          ],
        },
      ],
    },
  ],
};
