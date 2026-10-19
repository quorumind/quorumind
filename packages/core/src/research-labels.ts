import type { Locale } from "./locales.ts";

// The words of the web research in the documents: its section (the facts found and the numbered sources) and the line
// of the method box that says whether it was used and when, in the ten languages of the interface.

export interface ResearchLabels {
  heading: string;
  intro: string;
  sources: string;
  /** {date}: the day the page was read. */
  retrieved: string;
  /** {question}: the question of the research the page answers. */
  question: string;
  /** Under the claims of the verdict. */
  claimsNote: string;
  /** {date}, {engine}. */
  methodDone: string;
  /** {date}, {engine}. */
  methodEmpty: string;
  methodOff: string;
  methodEuropean: string;
  methodUnavailable: string;
  methodBudget: string;
  methodFailed: string;
  /** The engine of the recorded demo. */
  engineDemo: string;
}

export const RESEARCH_LABELS: Record<Locale, ResearchLabels> = {
  en: {
    heading: "Web research",
    intro:
      "Facts the debate depended on, checked on the web before the proposals, each with the pages it rests on. Web pages can be wrong or out of date: check those a decision hangs on.",
    sources: "Sources",
    retrieved: "retrieved on {date}",
    question: "Question: {question}",
    claimsNote: "A claim is marked verified only when it cites a source found by the web research.",
    methodDone:
      "Web research was done on {date} through {engine}, before the proposals: the facts it found are listed with their sources. Only short, generic queries were sent to the search engine, never the attached documents or personal data.",
    methodEmpty:
      "Web research was done on {date} through {engine}, but found nothing the debate could rely on: the facts come from the models' knowledge, which may be out of date.",
    methodOff:
      "No web research was done: the facts come from the models' knowledge, which may be out of date, and no claim is verified against a source.",
    methodEuropean:
      "No web research was done: this debate used European models only, and no search engine keeps the queries in Europe. The facts come from the models' knowledge, which may be out of date.",
    methodUnavailable:
      "Web research was asked for, but this server has no search engine configured: the facts come from the models' knowledge, which may be out of date.",
    methodBudget:
      "Web research was skipped to keep the debate within its cost cap: the facts come from the models' knowledge, which may be out of date.",
    methodFailed:
      "Web research failed and the debate went on without it: the facts come from the models' knowledge, which may be out of date.",
    engineDemo: "the recorded results of the demo",
  },
  fr: {
    heading: "Recherche sur le web",
    intro:
      "Les faits dont dépendait le débat, vérifiés sur le web avant les propositions, chacun avec les pages sur lesquelles il repose. Une page web peut se tromper ou dater : vérifiez ceux dont dépend une décision.",
    sources: "Sources",
    retrieved: "consultée le {date}",
    question: "Question : {question}",
    claimsNote: "Une affirmation n'est marquée vérifiée que si elle cite une source trouvée par la recherche sur le web.",
    methodDone:
      "Une recherche sur le web a été faite le {date} avec {engine}, avant les propositions : les faits trouvés sont présentés avec leurs sources. Seules des requêtes courtes et générales ont été envoyées au moteur de recherche, jamais les documents joints ni des données personnelles.",
    methodEmpty:
      "Une recherche sur le web a été faite le {date} avec {engine}, sans rien trouver de fiable pour le débat : les faits viennent des connaissances des modèles, qui peuvent être dépassées.",
    methodOff:
      "Aucune recherche sur le web n'a été faite : les faits viennent des connaissances des modèles, qui peuvent être dépassées, et aucune affirmation n'est vérifiée par une source.",
    methodEuropean:
      "Aucune recherche sur le web n'a été faite : ce débat n'a utilisé que des modèles européens, et aucun moteur de recherche ne garde les requêtes en Europe. Les faits viennent des connaissances des modèles, qui peuvent être dépassées.",
    methodUnavailable:
      "Une recherche sur le web était demandée, mais aucun moteur de recherche n'est configuré sur ce serveur : les faits viennent des connaissances des modèles, qui peuvent être dépassées.",
    methodBudget:
      "La recherche sur le web a été omise pour que le débat reste dans son plafond de coût : les faits viennent des connaissances des modèles, qui peuvent être dépassées.",
    methodFailed:
      "La recherche sur le web a échoué et le débat s'est poursuivi sans elle : les faits viennent des connaissances des modèles, qui peuvent être dépassées.",
    engineDemo: "les résultats enregistrés de la démo",
  },
  es: {
    heading: "Búsqueda en la web",
    intro:
      "Los hechos de los que dependía el debate, comprobados en la web antes de las propuestas, cada uno con las páginas en las que se basa. Una página web puede equivocarse o estar desactualizada: compruebe aquellos de los que depende una decisión.",
    sources: "Fuentes",
    retrieved: "consultada el {date}",
    question: "Pregunta: {question}",
    claimsNote: "Una afirmación solo se marca como verificada cuando cita una fuente encontrada por la búsqueda en la web.",
    methodDone:
      "Se hizo una búsqueda en la web el {date} con {engine}, antes de las propuestas: los hechos encontrados se presentan con sus fuentes. Al buscador solo se enviaron consultas breves y generales, nunca los documentos adjuntos ni datos personales.",
    methodEmpty:
      "Se hizo una búsqueda en la web el {date} con {engine}, pero no encontró nada fiable para el debate: los hechos proceden del conocimiento de los modelos, que puede estar desactualizado.",
    methodOff:
      "No se hizo ninguna búsqueda en la web: los hechos proceden del conocimiento de los modelos, que puede estar desactualizado, y ninguna afirmación está verificada con una fuente.",
    methodEuropean:
      "No se hizo ninguna búsqueda en la web: este debate solo usó modelos europeos, y ningún buscador mantiene las consultas en Europa. Los hechos proceden del conocimiento de los modelos, que puede estar desactualizado.",
    methodUnavailable:
      "Se pidió una búsqueda en la web, pero este servidor no tiene ningún buscador configurado: los hechos proceden del conocimiento de los modelos, que puede estar desactualizado.",
    methodBudget:
      "Se omitió la búsqueda en la web para que el debate no superara su límite de coste: los hechos proceden del conocimiento de los modelos, que puede estar desactualizado.",
    methodFailed:
      "La búsqueda en la web falló y el debate continuó sin ella: los hechos proceden del conocimiento de los modelos, que puede estar desactualizado.",
    engineDemo: "los resultados grabados de la demo",
  },
  pt: {
    heading: "Pesquisa na web",
    intro:
      "Os factos de que o debate dependia, verificados na web antes das propostas, cada um com as páginas em que se baseia. Uma página web pode estar errada ou desatualizada: verifique aqueles de que depende uma decisão.",
    sources: "Fontes",
    retrieved: "consultada em {date}",
    question: "Pergunta: {question}",
    claimsNote: "Uma afirmação só é marcada como verificada quando cita uma fonte encontrada pela pesquisa na web.",
    methodDone:
      "Foi feita uma pesquisa na web em {date} com {engine}, antes das propostas: os factos encontrados são apresentados com as suas fontes. Ao motor de pesquisa só foram enviadas consultas curtas e genéricas, nunca os documentos anexados nem dados pessoais.",
    methodEmpty:
      "Foi feita uma pesquisa na web em {date} com {engine}, mas não encontrou nada fiável para o debate: os factos vêm do conhecimento dos modelos, que pode estar desatualizado.",
    methodOff:
      "Não foi feita nenhuma pesquisa na web: os factos vêm do conhecimento dos modelos, que pode estar desatualizado, e nenhuma afirmação é verificada por uma fonte.",
    methodEuropean:
      "Não foi feita nenhuma pesquisa na web: este debate usou apenas modelos europeus, e nenhum motor de pesquisa mantém as consultas na Europa. Os factos vêm do conhecimento dos modelos, que pode estar desatualizado.",
    methodUnavailable:
      "Foi pedida uma pesquisa na web, mas este servidor não tem nenhum motor de pesquisa configurado: os factos vêm do conhecimento dos modelos, que pode estar desatualizado.",
    methodBudget:
      "A pesquisa na web foi omitida para manter o debate dentro do seu limite de custo: os factos vêm do conhecimento dos modelos, que pode estar desatualizado.",
    methodFailed:
      "A pesquisa na web falhou e o debate continuou sem ela: os factos vêm do conhecimento dos modelos, que pode estar desatualizado.",
    engineDemo: "os resultados gravados da demonstração",
  },
  it: {
    heading: "Ricerca sul web",
    intro:
      "I fatti da cui dipendeva il dibattito, verificati sul web prima delle proposte, ciascuno con le pagine su cui si basa. Una pagina web può sbagliare o essere superata: verificate quelli da cui dipende una decisione.",
    sources: "Fonti",
    retrieved: "consultata il {date}",
    question: "Domanda: {question}",
    claimsNote: "Un'affermazione è contrassegnata come verificata solo quando cita una fonte trovata dalla ricerca sul web.",
    methodDone:
      "È stata fatta una ricerca sul web il {date} con {engine}, prima delle proposte: i fatti trovati sono riportati con le loro fonti. Al motore di ricerca sono state inviate solo query brevi e generiche, mai i documenti allegati né dati personali.",
    methodEmpty:
      "È stata fatta una ricerca sul web il {date} con {engine}, ma non ha trovato nulla di affidabile per il dibattito: i fatti vengono dalle conoscenze dei modelli, che possono essere superate.",
    methodOff:
      "Non è stata fatta alcuna ricerca sul web: i fatti vengono dalle conoscenze dei modelli, che possono essere superate, e nessuna affermazione è verificata da una fonte.",
    methodEuropean:
      "Non è stata fatta alcuna ricerca sul web: questo dibattito ha usato solo modelli europei, e nessun motore di ricerca mantiene le query in Europa. I fatti vengono dalle conoscenze dei modelli, che possono essere superate.",
    methodUnavailable:
      "Era stata chiesta una ricerca sul web, ma su questo server non è configurato alcun motore di ricerca: i fatti vengono dalle conoscenze dei modelli, che possono essere superate.",
    methodBudget:
      "La ricerca sul web è stata saltata per mantenere il dibattito entro il suo tetto di costo: i fatti vengono dalle conoscenze dei modelli, che possono essere superate.",
    methodFailed:
      "La ricerca sul web non è riuscita e il dibattito è proseguito senza: i fatti vengono dalle conoscenze dei modelli, che possono essere superate.",
    engineDemo: "i risultati registrati della demo",
  },
  de: {
    heading: "Websuche",
    intro:
      "Die Fakten, von denen die Debatte abhing, vor den Vorschlägen im Web geprüft, jeweils mit den Seiten, auf denen sie beruhen. Webseiten können sich irren oder veraltet sein: Prüfen Sie die, von denen eine Entscheidung abhängt.",
    sources: "Quellen",
    retrieved: "abgerufen am {date}",
    question: "Frage: {question}",
    claimsNote: "Eine Aussage gilt nur dann als geprüft, wenn sie eine Quelle aus der Websuche nennt.",
    methodDone:
      "Vor den Vorschlägen wurde am {date} über {engine} im Web gesucht: Die gefundenen Fakten stehen mit ihren Quellen im Bericht. An die Suchmaschine gingen nur kurze, allgemeine Suchanfragen, nie die angehängten Dokumente oder personenbezogene Daten.",
    methodEmpty:
      "Am {date} wurde über {engine} im Web gesucht, ohne etwas zu finden, auf das sich die Debatte stützen konnte: Die Fakten stammen aus dem Wissen der Modelle, das veraltet sein kann.",
    methodOff:
      "Es wurde nicht im Web gesucht: Die Fakten stammen aus dem Wissen der Modelle, das veraltet sein kann, und keine Aussage ist durch eine Quelle geprüft.",
    methodEuropean:
      "Es wurde nicht im Web gesucht: Diese Debatte nutzte nur europäische Modelle, und keine Suchmaschine hält die Suchanfragen in Europa. Die Fakten stammen aus dem Wissen der Modelle, das veraltet sein kann.",
    methodUnavailable:
      "Eine Websuche war gewünscht, aber auf diesem Server ist keine Suchmaschine eingerichtet: Die Fakten stammen aus dem Wissen der Modelle, das veraltet sein kann.",
    methodBudget:
      "Die Websuche entfiel, damit die Debatte ihre Kostengrenze einhält: Die Fakten stammen aus dem Wissen der Modelle, das veraltet sein kann.",
    methodFailed:
      "Die Websuche ist fehlgeschlagen, und die Debatte lief ohne sie weiter: Die Fakten stammen aus dem Wissen der Modelle, das veraltet sein kann.",
    engineDemo: "die aufgezeichneten Ergebnisse der Demo",
  },
  hi: {
    heading: "वेब पर खोज",
    intro:
      "वे तथ्य जिन पर बहस निर्भर थी, प्रस्तावों से पहले वेब पर जाँचे गए, हर एक उन पेजों के साथ जिन पर वह आधारित है। वेब पेज गलत या पुराने हो सकते हैं: जिन तथ्यों पर कोई निर्णय टिका है, उन्हें जाँच लें।",
    sources: "स्रोत",
    retrieved: "{date} को देखा गया",
    question: "प्रश्न: {question}",
    claimsNote: "किसी दावे को सत्यापित तभी माना जाता है जब वह वेब खोज में मिले किसी स्रोत का हवाला दे।",
    methodDone:
      "प्रस्तावों से पहले, {date} को {engine} के ज़रिए वेब पर खोज की गई: मिले तथ्य उनके स्रोतों के साथ दिए गए हैं। सर्च इंजन को केवल छोटी, सामान्य खोज क्वेरी भेजी गईं, कभी संलग्न दस्तावेज़ या व्यक्तिगत डेटा नहीं।",
    methodEmpty:
      "{date} को {engine} के ज़रिए वेब पर खोज की गई, लेकिन बहस के लिए भरोसेमंद कुछ नहीं मिला: तथ्य मॉडलों के ज्ञान से आते हैं, जो पुराना हो सकता है।",
    methodOff: "वेब पर कोई खोज नहीं की गई: तथ्य मॉडलों के ज्ञान से आते हैं, जो पुराना हो सकता है, और कोई भी दावा किसी स्रोत से सत्यापित नहीं है।",
    methodEuropean:
      "वेब पर कोई खोज नहीं की गई: इस बहस में केवल यूरोपीय मॉडल इस्तेमाल हुए, और कोई भी सर्च इंजन खोज क्वेरी को यूरोप में नहीं रखता। तथ्य मॉडलों के ज्ञान से आते हैं, जो पुराना हो सकता है।",
    methodUnavailable: "वेब पर खोज माँगी गई थी, लेकिन इस सर्वर पर कोई सर्च इंजन कॉन्फ़िगर नहीं है: तथ्य मॉडलों के ज्ञान से आते हैं, जो पुराना हो सकता है।",
    methodBudget: "बहस को उसकी लागत सीमा के भीतर रखने के लिए वेब खोज छोड़ दी गई: तथ्य मॉडलों के ज्ञान से आते हैं, जो पुराना हो सकता है।",
    methodFailed: "वेब खोज विफल रही और बहस उसके बिना जारी रही: तथ्य मॉडलों के ज्ञान से आते हैं, जो पुराना हो सकता है।",
    engineDemo: "डेमो के रिकॉर्ड किए गए परिणाम",
  },
  ja: {
    heading: "ウェブ調査",
    intro:
      "討論の前提となった事実を、提案の前にウェブで確認したものです。各事実には根拠となるページを示しています。ウェブページは誤っていたり古かったりすることがあるため、判断を左右する事実は確認してください。",
    sources: "出典",
    retrieved: "{date}に取得",
    question: "質問：{question}",
    claimsNote: "主張は、ウェブ調査で見つかった出典を引用している場合にのみ「検証済み」と表示されます。",
    methodDone:
      "提案の前に、{date}に{engine}でウェブ調査を行いました。見つかった事実は出典とともに示しています。検索エンジンに送ったのは短く一般的な検索語だけで、添付文書や個人データは一切送っていません。",
    methodEmpty:
      "{date}に{engine}でウェブ調査を行いましたが、討論が拠り所にできる情報は見つかりませんでした。事実はモデルの知識に基づいており、古い可能性があります。",
    methodOff: "ウェブ調査は行っていません。事実はモデルの知識に基づいており、古い可能性があります。出典で検証された主張はありません。",
    methodEuropean:
      "ウェブ調査は行っていません。この討論では欧州のモデルのみを使用しており、検索語を欧州内にとどめる検索エンジンはありません。事実はモデルの知識に基づいており、古い可能性があります。",
    methodUnavailable:
      "ウェブ調査が指定されましたが、このサーバーには検索エンジンが設定されていません。事実はモデルの知識に基づいており、古い可能性があります。",
    methodBudget: "討論を費用上限内に収めるため、ウェブ調査は省略されました。事実はモデルの知識に基づいており、古い可能性があります。",
    methodFailed: "ウェブ調査に失敗したため、討論は調査なしで続行されました。事実はモデルの知識に基づいており、古い可能性があります。",
    engineDemo: "デモの記録済み結果",
  },
  "zh-Hans": {
    heading: "网络调研",
    intro: "辩论所依赖的事实，在提出方案之前已在网上核实，每条事实都附有其依据的网页。网页可能有误或已过时：请核实那些决定所依赖的事实。",
    sources: "来源",
    retrieved: "于{date}获取",
    question: "问题：{question}",
    claimsNote: "只有引用了网络调研所找到的来源的论断，才会标记为已核实。",
    methodDone:
      "在提出方案之前，于{date}通过{engine}进行了网络调研：找到的事实与其来源一并列出。发送给搜索引擎的只有简短、通用的搜索词，从不包含附件文档或个人数据。",
    methodEmpty: "于{date}通过{engine}进行了网络调研，但没有找到辩论可以依据的内容：事实来自模型的知识，可能已经过时。",
    methodOff: "未进行网络调研：事实来自模型的知识，可能已经过时，且没有任何论断经过来源核实。",
    methodEuropean:
      "未进行网络调研：本次辩论只使用欧洲模型，而没有任何搜索引擎能将搜索词保留在欧洲境内。事实来自模型的知识，可能已经过时。",
    methodUnavailable: "已要求进行网络调研，但此服务器未配置搜索引擎：事实来自模型的知识，可能已经过时。",
    methodBudget: "为使辩论不超出费用上限，已跳过网络调研：事实来自模型的知识，可能已经过时。",
    methodFailed: "网络调研失败，辩论在没有调研的情况下继续进行：事实来自模型的知识，可能已经过时。",
    engineDemo: "演示的录制结果",
  },
  ar: {
    heading: "البحث على الويب",
    intro:
      "الحقائق التي اعتمد عليها النقاش، تم التحقق منها على الويب قبل المقترحات، وكل منها مع الصفحات التي يستند إليها. قد تكون صفحات الويب خاطئة أو قديمة: تحقق من الحقائق التي يتوقف عليها القرار.",
    sources: "المصادر",
    retrieved: "تم الاطلاع عليها في {date}",
    question: "السؤال: {question}",
    claimsNote: "لا يُعَدّ الادعاء متحققًا منه إلا إذا استشهد بمصدر وجده البحث على الويب.",
    methodDone:
      "أُجري بحث على الويب في {date} عبر {engine}، قبل المقترحات: الحقائق التي وُجدت معروضة مع مصادرها. لم تُرسَل إلى محرك البحث سوى عبارات بحث قصيرة وعامة، ولم تُرسَل أبدًا المستندات المرفقة ولا البيانات الشخصية.",
    methodEmpty:
      "أُجري بحث على الويب في {date} عبر {engine}، لكنه لم يجد شيئًا يمكن للنقاش الاعتماد عليه: الحقائق مصدرها معرفة النماذج، وقد تكون قديمة.",
    methodOff: "لم يُجرَ أي بحث على الويب: الحقائق مصدرها معرفة النماذج، وقد تكون قديمة، ولا يوجد ادعاء متحقق منه بمصدر.",
    methodEuropean:
      "لم يُجرَ أي بحث على الويب: استخدم هذا النقاش نماذج أوروبية فقط، ولا يوجد محرك بحث يُبقي عبارات البحث داخل أوروبا. الحقائق مصدرها معرفة النماذج، وقد تكون قديمة.",
    methodUnavailable: "طُلب بحث على الويب، لكن لا يوجد محرك بحث مُعَدّ على هذا الخادم: الحقائق مصدرها معرفة النماذج، وقد تكون قديمة.",
    methodBudget: "تم تخطي البحث على الويب لإبقاء النقاش ضمن حد التكلفة: الحقائق مصدرها معرفة النماذج، وقد تكون قديمة.",
    methodFailed: "فشل البحث على الويب واستمر النقاش بدونه: الحقائق مصدرها معرفة النماذج، وقد تكون قديمة.",
    engineDemo: "النتائج المسجلة للعرض التجريبي",
  },
};

export function researchLabels(locale: Locale): ResearchLabels {
  return RESEARCH_LABELS[locale] ?? RESEARCH_LABELS.en;
}
