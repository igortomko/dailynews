import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function AboutPage() {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Как собирается лента</CardTitle>
          <CardDescription>Четыре каскада, и дорогая модель работает только на последнем.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <ol className="flex flex-col gap-3">
            {[
              ["Сбор", "Весь поток без фильтрации — сотни материалов в день со всех включённых источников."],
              ["Оценка", "Каждый материал получает восемь типизированных вопросов за один проход. Это дёшево настолько, что прогоняется весь поток, а не выборка."],
              ["Отбор", "Код сортирует по составному скору и берёт по кругу: лучшее в каждой теме, потом вторые по каждой."],
              ["Дайджест", "Модель пишет по выжившим — двенадцать материалов вместо трёхсот."],
            ].map(([title, text], index) => (
              <li key={title} className="flex gap-3">
                <span className="w-5 shrink-0 tabular-nums text-muted-foreground">{index + 1}</span>
                <span>
                  <b className="font-medium">{title}.</b>{" "}
                  <span className="text-muted-foreground">{text}</span>
                </span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Восемь осей</CardTitle>
          <CardDescription>
            Не «важность вообще», а различения, по которым решаешь — открыть или пролистать.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {[
              ["тема", "к какому из твоих интересов относится"],
              ["тип", "факт, прогноз, мнение, анонс, перепечатка"],
              ["новизна", "событие или пережёвывание известного"],
              ["конкретика", "цифры, названный источник, первичные данные"],
              ["горизонт", "шум дня, месяцы или годы"],
              ["actionability", "требует ли действия сейчас"],
              ["кликбейт", "обещает ли заголовок больше, чем даёт текст"],
              ["самодостаточность", "есть ли за материалом работа"],
            ].map(([term, meaning]) => (
              <div key={term} className="flex gap-2">
                <dt className="font-medium">{term}</dt>
                <dd className="text-muted-foreground">— {meaning}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Калибровка</CardTitle>
          <CardDescription>Без неё любой отбор — угадывание.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Каждый показ, раскрытие и оценка записываются со снимком скора на тот момент.
          Если доля прочитанного не растёт с ростом скора — отбор не работает. Если высокая
          уверенность не совпадает с прочитанным — неверно подобраны сами оси, а не их веса.
        </CardContent>
      </Card>
    </div>
  );
}
