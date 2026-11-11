// Storyboards for the role tutorial videos (Russian). Each step is captured from the
// running app: `go` opens a page, `before` performs real UI actions, `target` is the
// element that the video highlights, `caption` is shown on screen, `say` is narrated.
// Narration spells brand names phonetically for the speech engine.

const loginSteps = (email, password = "Demo#2026!") => [
  {
    go: "/login",
    before: async (p) => {
      await p.fill("input[name=email]", email);
      await p.fill("input[name=password]", password);
    },
    target: "form",
    caption: "Введи почту и пароль, потом нажми «Войти»",
    say: "Открой сайт. Впиши свою почту и пароль. Потом нажми большую зелёную кнопку «Войти».",
    after: async (p) => {
      await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/login")), p.click("button[type=submit]")]);
    },
  },
];

const card = (h2) => `main .card:has(h2:text-is("${h2}"))`;

export const ROLES = [
  {
    key: "01-owner",
    title: "Владелец компании",
    emoji: "👑",
    who: "Ты — главный в компании. Ты смотришь, как идут дела.",
    email: "owner@safi-demo.uz",
    intro: "Привет! Сейчас я покажу, как работает владелец компании в платформе Поултри О Эс. Владелец — самый главный. Он смотрит, как идут дела, и следит, чтобы всё было хорошо.",
    steps: [
      ...loginSteps("owner@safi-demo.uz"),
      {
        go: "/app",
        target: "main a:has-text('Производство (товарное)')",
        caption: "«Обзор» — главная страница с самыми важными цифрами",
        say: "Это главная страница. Она называется «Обзор». Здесь, как на приборной панели в машине, видно самое важное: сколько мяса сделали сегодня.",
      },
      {
        target: "main a:has-text('Активные заказы')",
        caption: "Сколько заказов ждут доставки",
        say: "А здесь видно, сколько заказов ещё ждут доставки. Чем меньше это число вечером, тем лучше.",
      },
      {
        target: "main button:text-is('7 дней')",
        caption: "Нажми «7 дней» или «30 дней», чтобы увидеть за неделю или месяц",
        say: "Хочешь посмотреть цифры за неделю или за месяц? Нажми «7 дней» или «30 дней», и всё сразу пересчитается.",
      },
      {
        target: card("Открытые оповещения"),
        caption: "Оповещения: красные — самые срочные",
        say: "Справа — оповещения. Это подсказки, что нужно проверить. Красные — самые срочные.",
      },
      {
        target: "aside nav",
        caption: "Слева — меню. Каждый пункт — отдельный участок работы",
        say: "Слева находится меню. Каждый пункт — это отдельный участок работы: закупки, производство, склад, заказы и доставка.",
      },
      {
        go: "/app/reports",
        target: "main a:text-is('Excel') >> nth=0",
        caption: "«Отчёты»: любую таблицу можно скачать в Excel",
        say: "В разделе «Отчёты» собраны графики. Любую таблицу можно скачать в Эксель одной кнопкой.",
      },
      {
        go: "/app/employees",
        target: "main button:has-text('Пригласить пользователя')",
        caption: "«Сотрудники» → «Пригласить пользователя»",
        say: "Чтобы добавить нового работника, открой «Сотрудники» и нажми «Пригласить пользователя».",
      },
      {
        go: "/app/settings/subscription",
        target: "main .card >> nth=0",
        caption: "«Подписка»: твой тариф и сколько людей работает",
        say: "В разделе «Подписка и оплата» видно твой тариф и сколько людей уже работает в системе.",
      },
      {
        target: "header :text-is('UZ') >> xpath=..",
        pad: 10,
        caption: "Язык: русский, узбекский или английский",
        say: "А вот здесь можно выбрать язык: русский, узбекский или английский.",
      },
    ],
    outro: "Молодец! Запомни три главных места: «Обзор» — чтобы смотреть, «Отчёты» — чтобы скачивать, «Сотрудники» — чтобы приглашать людей.",
    points: ["«Обзор» — смотреть цифры", "«Отчёты» — скачать в Excel", "«Сотрудники» — пригласить людей"],
  },

  {
    key: "02-company-admin",
    title: "Администратор компании",
    emoji: "🛠️",
    who: "Ты помогаешь всем работать: добавляешь людей и настраиваешь систему.",
    email: "admin@safi-demo.uz",
    intro: "Привет! Это видео для администратора компании. Администратор — это помощник, который добавляет людей и настраивает правила работы.",
    steps: [
      ...loginSteps("admin@safi-demo.uz"),
      {
        go: "/app/employees",
        target: "main table",
        caption: "Здесь список всех работников",
        say: "Открой раздел «Сотрудники». Здесь список всех работников компании, их роли и отделы.",
      },
      {
        before: async (p) => {
          await p.click("main button:has-text('Пригласить пользователя')");
          await p.waitForSelector("[role=dialog]");
        },
        target: "[role=dialog]",
        caption: "Впиши почту, выбери роль и отдел — человеку придёт письмо",
        say: "Нажми «Пригласить пользователя». Впиши почту работника, выбери его роль и отдел. Ему придёт письмо со ссылкой.",
        after: async (p) => {
          await p.keyboard.press("Escape");
        },
      },
      {
        go: "/app/employees/roles",
        target: "main .card >> nth=0",
        caption: "Роли решают, кто что может видеть и делать",
        say: "Во вкладке «Роли» видно, кто что может делать. Например, кладовщик не видит деньги. Так и должно быть.",
      },
      {
        go: "/app/settings",
        target: "input[name=batchFormat]",
        pad: 14,
        caption: "Формат номера партии, например SAFI-20261111-FARM001-0001",
        say: "В «Настройках» задаётся, как будет выглядеть номер каждой партии мяса. Система сама подставит дату, ферму и порядковый номер.",
      },
      {
        target: "input[name=chilledMaxTempC]",
        pad: 14,
        caption: "Правила: допустимая температура и срок хранения",
        say: "Здесь же правила: какая температура нужна для охлаждённого мяса и сколько часов его можно хранить.",
      },
      {
        go: "/app/settings/audit",
        target: "main table",
        caption: "«Журнал аудита» — кто и что изменил",
        say: "«Журнал аудита» — это как дневник. В нём записано, кто, когда и что изменил.",
      },
      {
        go: "/app/integrations",
        target: "main .card >> nth=0",
        caption: "Интеграции: если не подключено — так и написано",
        say: "В «Интеграциях» подключают другие программы, например Дидокс или один-эс. Пока они не подключены, здесь честно написано: «Не подключено».",
      },
    ],
    outro: "Отлично! Ты умеешь приглашать людей, выдавать им роли и настраивать правила компании.",
    points: ["Пригласить работника", "Выдать роль и отдел", "Настроить правила"],
  },

  {
    key: "03-department-manager",
    title: "Руководитель отдела (производство)",
    emoji: "🏭",
    who: "Ты отвечаешь за свой участок — например, за производство.",
    email: "production@safi-demo.uz",
    intro: "Привет! Это видео для руководителя отдела. Покажем на примере начальника производства: он принимает птицу, следит за сменой и решает, сколько мяса сделать завтра.",
    steps: [
      ...loginSteps("production@safi-demo.uz"),
      {
        go: "/app",
        target: "aside nav",
        caption: "В меню — только разделы твоего отдела",
        say: "Посмотри на меню слева. В нём только то, что нужно твоему отделу. Лишнего ничего нет.",
      },
      {
        go: "/app/receiving",
        target: "main a:has-text('Принять поставку')",
        caption: "Приехала машина с птицей? Нажми «Принять поставку»",
        say: "Когда приезжает машина с птицей, открой «Приёмка сырья» и нажми «Принять поставку».",
      },
      {
        go: "/app/receiving/new",
        before: async (p) => {
          await p.selectOption("select[name=supplierId]", { index: 1 });
          await p.waitForTimeout(300);
          await p.selectOption("select[name=farmId]", { index: 1 });
          await p.fill("input[name=vehiclePlate]", "01 A 777 AA");
          await p.fill("input[name=driverName]", "Алишер");
          await p.fill("input[name=vetCertificateNo]", "VET-2026-1111");
          await p.fill("input[name=birdsDeclared]", "2000");
          await p.fill("input[name=birdsReceived]", "2000");
          await p.fill("input[name=birdsDeadOnArrival]", "4");
          await p.fill("input[name=grossWeightKg]", "14820");
          await p.fill("input[name=tareWeightKg]", "9640");
        },
        target: "input[name=grossWeightKg] >> xpath=ancestor::*[contains(@class,'card')][1]",
        caption: "Впиши вес машины с птицей и вес пустой машины",
        say: "Впиши, сколько весит машина с птицей и сколько весит пустая машина. Разницу система посчитает сама.",
      },
      {
        before: async (p) => {
          await p.fill("input[name=bodyTempC]", "41.5");
          await p.fill("input[name=feedWithdrawalHours]", "8");
          await p.fill("input[name=bruisingPct]", "1");
          await p.fill("input[name=r_bodytemp]", "41.5");
          const radios = await p.locator("input[type=radio][value=yes]").all();
          for (const r of radios) await r.check().catch(() => {});
          await p.locator("button:has-text('Принять')").first().click();
        },
        target: "main button:has-text('Сохранить и создать партию')",
        caption: "Проверь качество и нажми «Сохранить и создать партию»",
        say: "Отметь проверку качества, выбери «Принять» и нажми «Сохранить и создать партию».",
        after: async (p) => {
          await p.click("main button:has-text('Сохранить и создать партию')");
          await p.waitForURL(/\/app\/receiving\/(?!new)/, { timeout: 15000 });
        },
      },
      {
        target: "main :text-matches('SAFI-\\\\d{8}-FARM\\\\d+-\\\\d{4}') >> nth=0",
        pad: 16,
        caption: "Готово! У партии появился свой номер",
        say: "Готово! У партии появился свой номер. По нему потом всегда можно узнать, с какой фермы это мясо.",
      },
      {
        go: "/app/production",
        target: "main button:has-text('Открыть смену')",
        caption: "Чтобы начать работу, нажми «Открыть смену»",
        say: "Чтобы начать работу цеха, открой «Производство» и нажми «Открыть смену».",
      },
      {
        before: async (p) => {
          await p.click("main table tbody tr >> nth=0 >> a");
          await p.waitForURL(/shifts\//);
        },
        target: card("Баланс масс"),
        caption: "Баланс масс: сколько птицы зашло и сколько продукции вышло",
        say: "Внутри смены видно, сколько птицы зашло в цех и сколько продукции вышло. Ничего не должно потеряться.",
      },
      {
        target: card("Выход по продуктам"),
        caption: "Процент выхода считается сам",
        say: "А здесь процент выхода по каждому продукту: грудка, крылья, окорочка. Считать вручную не нужно.",
      },
      {
        go: "/app/production/planning",
        target: "main button:has-text('Утвердить план')",
        caption: "Система подсказывает, сколько произвести. Можно поправить",
        say: "В «Прогнозе спроса» система подсказывает, сколько мяса сделать завтра. Цифры можно поправить и нажать «Утвердить план».",
      },
    ],
    outro: "Здорово! Ты умеешь принимать птицу, следить за сменой и планировать завтрашний день.",
    points: ["Принять птицу и создать партию", "Открыть смену и смотреть выход", "Утвердить план на завтра"],
  },

  {
    key: "04-employee-warehouse",
    title: "Сотрудник склада",
    emoji: "📦",
    who: "Ты работаешь на складе: хранишь, перемещаешь и отгружаешь продукцию.",
    email: "warehouse@safi-demo.uz",
    intro: "Привет! Это видео для сотрудника склада. На складе важно знать, где лежит продукция и когда у неё заканчивается срок.",
    steps: [
      ...loginSteps("warehouse@safi-demo.uz"),
      {
        go: "/app/inventory",
        target: "main a:has-text('Текущий остаток')",
        caption: "Сколько всего продукции на складе",
        say: "Открой «Запасы и склады». Здесь видно, сколько всего продукции лежит на складе.",
      },
      {
        target: "main a:has-text('Истекает ≤ 24 ч')",
        caption: "Срок скоро закончится — отгружай это первым!",
        say: "Эти плитки показывают продукцию, у которой скоро закончится срок. Её нужно отгрузить первой. Правило простое: что раньше портится, то раньше уходит.",
      },
      {
        target: "main table tbody tr >> nth=0",
        caption: "Одна строка — одна партия: что, где и до какого числа",
        say: "Каждая строка таблицы — одна партия: какой продукт, в какой камере лежит и до какого числа годен.",
      },
      {
        go: "/app/inventory/scan",
        before: async (p) => {
          const code = await p.evaluate(async () => {
            const r = await fetch("/app/inventory");
            const html = await r.text();
            return (html.match(/SAFI-\d{8}-FARM\d+-\d{4}/) || [""])[0];
          });
          await p.fill("main input", code);
        },
        target: "main form",
        caption: "Отсканируй этикетку или впиши номер партии",
        say: "Наведи сканер на этикетку или впиши номер партии и нажми «Найти».",
        after: async (p) => {
          await p.click("main button:has-text('Найти')");
          await p.waitForLoadState("networkidle");
        },
      },
      {
        target: "main .card >> nth=1",
        caption: "Здесь всё о партии: где лежит и сколько осталось",
        say: "Система сразу покажет, где лежит эта партия и сколько её осталось.",
      },
      {
        go: "/app/inventory/transfers",
        target: "main button:has-text('Новое перемещение')",
        caption: "Перенести в другую камеру — «Новое перемещение»",
        say: "Если нужно перенести продукцию в другую камеру или магазин, нажми «Новое перемещение».",
      },
      {
        go: "/app/inventory/stocktakes",
        target: "main button:has-text('Начать инвентаризацию')",
        caption: "Посчитать всё на складе — «Начать инвентаризацию»",
        say: "Когда нужно всё пересчитать, нажми «Начать инвентаризацию». Система сама покажет, где есть разница.",
      },
    ],
    outro: "Супер! Главное правило склада: первым отгружаем то, у чего раньше заканчивается срок.",
    points: ["Смотреть остатки и сроки", "Найти партию по этикетке", "Перемещение и инвентаризация"],
  },

  {
    key: "05-driver",
    title: "Водитель",
    emoji: "🚚",
    who: "Ты возишь продукцию клиентам и следишь за холодом в машине.",
    email: "driver@safi-demo.uz",
    mobile: true,
    intro: "Привет! Это видео для водителя. Водитель работает с телефона: смотрит свои доставки, записывает температуру и отмечает, что всё привёз.",
    steps: [
      ...loginSteps("driver@safi-demo.uz"),
      {
        go: "/app/logistics/driver",
        target: "main .card:has-text('Запланировано')",
        caption: "Твой рейс на сегодня: машина, время и адреса",
        say: "Открой «Мои доставки». Здесь твой рейс на сегодня: номер машины, время выезда и все адреса по порядку.",
      },
      {
        target: "main button:has-text('Начать рейс')",
        caption: "Загрузился? Нажми «Начать рейс»",
        say: "Когда машина загружена, нажми «Начать рейс».",
        after: async (p) => {
          await p.click("main button:has-text('Начать рейс')");
          await p.waitForSelector("[role=alertdialog]");
        },
      },
      {
        target: "[role=alertdialog]",
        caption: "Подтверди — и можно ехать",
        say: "Система спросит ещё раз. Подтверди, и можно ехать.",
        after: async (p) => {
          await p.locator("[role=alertdialog] button").last().click();
          await p.waitForSelector("main button:has-text('Подтвердить доставку')", { timeout: 15000 });
        },
      },
      {
        before: async (p) => {
          await p.locator("main button:has-text('температур')").first().click();
          await p.waitForSelector("[role=dialog]");
          await p.fill("[role=dialog] input[type=number] >> nth=0", "2.8");
        },
        target: "[role=dialog]",
        caption: "Запиши температуру в кузове: для охлаждённого — от 0 до +4 °C",
        say: "В дороге записывай температуру в кузове. Для охлаждённого мяса она должна быть от нуля до плюс четырёх градусов.",
        after: async (p) => {
          await p.locator("[role=dialog] button[type=submit]").click();
          await p.waitForSelector("[role=dialog]", { state: "detached" });
        },
      },
      {
        target: "main button:has-text('Подтвердить доставку') >> nth=0",
        caption: "Приехал к клиенту? Нажми «Подтвердить доставку»",
        say: "Приехал к первому клиенту? Отдай товар и нажми «Подтвердить доставку».",
        after: async (p) => {
          await p.locator("main button:has-text('Подтвердить доставку')").first().click();
          await p.waitForSelector("[role=dialog]");
          const inputs = p.locator("[role=dialog] input[type=text]");
          if (await inputs.count()) await inputs.first().fill("Шерзод");
        },
      },
      {
        target: "[role=dialog]",
        caption: "Впиши, кто принял товар, и подтверди",
        say: "Впиши имя человека, который принял товар, и подтверди. Всё, эта точка закрыта!",
        after: async (p) => {
          await p.locator("[role=dialog] button[type=submit]").click();
          await p.waitForSelector("[role=dialog]", { state: "detached" });
          await p.waitForTimeout(800);
        },
      },
      {
        target: "main .card:has-text('В пути')",
        caption: "Зелёная отметка «Доставлен» — точка выполнена",
        say: "Видишь зелёную отметку «Доставлен»? Значит, всё сделано правильно. Едем к следующему клиенту.",
      },
    ],
    outro: "Отлично! Три кнопки водителя: «Начать рейс», «Записать температуру» и «Подтвердить доставку».",
    points: ["«Начать рейс»", "Записать температуру", "«Подтвердить доставку»"],
  },

  {
    key: "06-b2b-customer",
    title: "Клиент (портал покупателя)",
    emoji: "🛒",
    who: "Ты покупаешь мясо для своего магазина или ресторана.",
    email: "buyer@baraka-demo.uz",
    intro: "Привет! Это видео для покупателя, например для магазина или ресторана. Здесь ты сам делаешь заказы и видишь, где сейчас твой товар.",
    steps: [
      ...loginSteps("buyer@baraka-demo.uz"),
      {
        go: "/portal",
        target: "main a:has-text('Открытые заказы')",
        caption: "Твой личный кабинет: заказы и счета",
        say: "Это твой личный кабинет. Сразу видно, сколько заказов в работе и сколько счетов нужно оплатить.",
      },
      {
        go: "/portal/catalog",
        target: "main table",
        caption: "«Каталог» — товары и твои цены",
        say: "В «Каталоге» видны все товары и твои цены по договору.",
      },
      {
        go: "/portal/orders/new",
        before: async (p) => {
          const d = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
          await p.fill("input[name=requestedDeliveryDate]", d);
          await p.locator("main select").first().selectOption({ index: 1 });
          await p.locator("main input[type=number]").first().fill("120");
        },
        target: "main form",
        caption: "Выбери дату, товар и сколько килограммов нужно",
        say: "Нажми «Новый заказ». Выбери дату доставки, товар и впиши, сколько килограммов нужно.",
      },
      {
        target: "main button:has-text('Отправить заказ')",
        caption: "Нажми «Отправить заказ»",
        say: "Нажми «Отправить заказ». Компания сразу увидит твой заказ.",
        after: async (p) => {
          await p.click("main button:has-text('Отправить заказ')");
          await p.waitForURL(/\/portal\/orders\/(?!new)/, { timeout: 15000 });
        },
      },
      {
        target: "main",
        caption: "Заказ создан! Статус «Новый»",
        say: "Готово, заказ создан! Сейчас у него статус «Новый». Потом он станет «Подтверждён», «Собирается» и «В доставке».",
      },
      {
        go: "/portal/orders",
        target: "main table",
        caption: "«Мои заказы» — где сейчас каждый заказ",
        say: "В разделе «Мои заказы» видно, где сейчас каждый твой заказ.",
      },
      {
        go: "/portal/documents",
        target: "main table tbody tr >> nth=0",
        caption: "«Документы» — счета и накладные",
        say: "А в «Документах» лежат счета и накладные. Их можно открыть и распечатать.",
      },
    ],
    outro: "Молодец! Теперь ты умеешь сам заказывать товар и следить за ним.",
    points: ["«Каталог» — цены", "«Новый заказ» — заказать", "«Мои заказы» — следить"],
  },

  {
    key: "07-super-admin",
    title: "Суперадмин платформы",
    emoji: "🌐",
    who: "Ты управляешь всей платформой и всеми компаниями-клиентами.",
    email: "admin@poultryos.local",
    password: "Admin#2026!",
    intro: "Привет! Это видео для суперадмина. Суперадмин управляет всей платформой: всеми компаниями, тарифами и оплатами.",
    steps: [
      ...loginSteps("admin@poultryos.local", "Admin#2026!"),
      {
        go: "/admin",
        target: "main",
        caption: "Обзор платформы: компании, оплаты, активность",
        say: "Это обзор всей платформы: сколько компаний работает, какие счета не оплачены и что происходило.",
      },
      {
        go: "/admin/organizations",
        target: "main table",
        caption: "Все компании-клиенты",
        say: "В разделе «Организации» список всех компаний, которые пользуются платформой.",
      },
      {
        before: async (p) => {
          await p.click("main table a >> nth=0");
          await p.waitForURL(/organizations\/.+/);
        },
        target: card("Подписка"),
        caption: "Тариф и статус подписки компании",
        say: "Открой компанию. Здесь можно поменять её тариф и статус подписки.",
      },
      {
        target: card("Доступные разделы"),
        caption: "Включить или выключить разделы для компании",
        say: "Здесь можно включить или выключить отдельные разделы для этой компании.",
      },
      {
        target: "main button:has-text('Приостановить')",
        caption: "«Приостановить» — временно закрыть доступ",
        say: "Если компания долго не платит, её можно временно приостановить. Система обязательно переспросит.",
      },
      {
        go: "/admin/plans",
        target: "main .card >> nth=0",
        caption: "Тарифы и цены: STARTER, GROWTH, ENTERPRISE",
        say: "В «Тарифах» задаются цены и что входит в каждый тариф.",
      },
      {
        go: "/admin/billing",
        target: "main",
        caption: "Оплаты подтверждаются только вручную, по банковскому переводу",
        say: "В «Оплатах» ты вручную подтверждаешь банковский перевод. Сама система деньги не принимает и оплату не выдумывает.",
      },
      {
        go: "/admin/emails",
        target: "main",
        caption: "«Исходящие письма» — все письма платформы",
        say: "А в «Исходящих письмах» видны все письма: приглашения, сброс пароля и приветствия.",
      },
    ],
    outro: "Отлично! Суперадмин следит за компаниями, тарифами и оплатами всей платформы.",
    points: ["Компании и тарифы", "Включить разделы", "Подтвердить оплату"],
  },
];
