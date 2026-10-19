import { isLocale, type Locale } from "@quorumind/core";

// The words of the e-mails the server sends (a debate that ended or waits for an answer, a client's answers, a
// decision to review or to approve), in the ten languages of the interface. The debate's title is never translated.

/** The language of an e-mail from a locale tag ("fr-FR", "pt-BR", "zh"), English when it is none of the ten. */
export function mailLocale(value: string | null | undefined): Locale {
  if (!value) return "en";
  if (isLocale(value)) return value;
  const base = value.toLowerCase().split(/[-_]/)[0];
  if (base === "zh") return "zh-Hans";
  return isLocale(base) ? base : "en";
}

export interface NotificationLabels {
  /** {title} is the debate's title. */
  subject: string;
  preheader: string;
  heading: string;
  body: string;
  action: string;
}

export type NotificationKind = "complete" | "awaiting_answers" | "failed" | "answers_received" | "review_due" | "approval_requested";

export interface NotifierLabels {
  /** Above the address of the button, for clients that drop buttons. */
  linkHint: string;
  /** Why the person gets it: they ticked "E-mail me when the debate ends or needs my answer". */
  footerNotify: string;
  /** They started the session (a client's answers, an approval asked of them). */
  footerAuthor: string;
  /** They wrote or approved the decision to review. */
  footerReview: string;
  /** A self-hosted server without sign-in sends everything to its own address. */
  footerServer: string;
  messages: Record<NotificationKind, NotificationLabels>;
}

export const NOTIFIER_LABELS: Record<Locale, NotifierLabels> = {
  en: {
    linkHint: "If the button does not work, copy this link into your browser:",
    footerNotify: "You receive this e-mail because e-mail notifications are on for this debate.",
    footerAuthor: "You receive this e-mail because you started this session.",
    footerReview: "You receive this e-mail because you wrote or approved this decision.",
    footerServer: "This Quorumind server sends its notifications to this address.",
    messages: {
      complete: {
        subject: "Verdict ready: {title}",
        preheader: "The arbiter has ruled: the verdict and the report are ready.",
        heading: "The verdict is ready",
        body: "The arbiter has ruled. Open the session to read the verdict and download the report.",
        action: "Read the verdict",
      },
      awaiting_answers: {
        subject: "Your answer is needed: {title}",
        preheader: "The debate resumes as soon as you reply.",
        heading: "The debate needs your answer",
        body: "To go on, the models need information only you have. Answer their questions and the debate resumes.",
        action: "Answer the questions",
      },
      failed: {
        subject: "Session stopped: {title}",
        preheader: "Nothing done so far is lost: resume it from where it stopped.",
        heading: "The session stopped",
        body: "The session stopped on an error. Open it to resume from where it stopped: nothing done so far is lost.",
        action: "Resume the session",
      },
      answers_received: {
        subject: "Your client answered: {title}",
        preheader: "Read the answers, then update the recommendation.",
        heading: "Your client answered the questionnaire",
        body: "Open the session to read the answers, then update the recommendation with them.",
        action: "Read the answers",
      },
      review_due: {
        subject: "Decision to review: {title}",
        preheader: "Check that the decision still holds.",
        heading: "A decision is due for review",
        body: "The date set to revisit this decision has come. Open it to check that it still holds: approve it again, update it with what changed, or mark it as superseded.",
        action: "Review the decision",
      },
      approval_requested: {
        subject: "Approval requested: {title}",
        preheader: "Approve or reject the decision from its session.",
        heading: "A decision is waiting for your approval",
        body: "A member of the team asks for this decision to be approved. Open it to approve or reject it.",
        action: "Open the decision",
      },
    },
  },
  fr: {
    linkHint: "Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :",
    footerNotify: "Vous recevez cet e-mail parce que les notifications par e-mail sont activées pour ce débat.",
    footerAuthor: "Vous recevez cet e-mail parce que vous avez lancé cette session.",
    footerReview: "Vous recevez cet e-mail parce que vous avez rédigé ou approuvé cette décision.",
    footerServer: "Ce serveur Quorumind envoie ses notifications à cette adresse.",
    messages: {
      complete: {
        subject: "Verdict prêt : {title}",
        preheader: "L'arbitre a tranché : le verdict et le rapport sont prêts.",
        heading: "Le verdict est prêt",
        body: "L'arbitre a rendu son verdict. Ouvrez la session pour le lire et télécharger le rapport.",
        action: "Lire le verdict",
      },
      awaiting_answers: {
        subject: "Votre réponse est attendue : {title}",
        preheader: "Le débat reprend dès que vous répondez.",
        heading: "Le débat attend votre réponse",
        body: "Pour continuer, les modèles ont besoin d'informations que vous détenez. Répondez à leurs questions et le débat reprend.",
        action: "Répondre aux questions",
      },
      failed: {
        subject: "Session arrêtée : {title}",
        preheader: "Rien n'est perdu : reprenez-la là où elle s'est arrêtée.",
        heading: "La session s'est arrêtée",
        body: "La session s'est arrêtée sur une erreur. Ouvrez-la pour la reprendre là où elle s'est arrêtée : rien de ce qui a été fait n'est perdu.",
        action: "Reprendre la session",
      },
      answers_received: {
        subject: "Votre client a répondu : {title}",
        preheader: "Lisez ses réponses, puis mettez la recommandation à jour.",
        heading: "Votre client a répondu au questionnaire",
        body: "Ouvrez la session pour lire ses réponses, puis mettez la recommandation à jour avec elles.",
        action: "Lire les réponses",
      },
      review_due: {
        subject: "Décision à réexaminer : {title}",
        preheader: "Vérifiez que la décision tient toujours.",
        heading: "Une décision est à réexaminer",
        body: "La date fixée pour revoir cette décision est arrivée. Ouvrez-la pour vérifier qu'elle tient toujours : approuvez-la de nouveau, mettez-la à jour avec ce qui a changé ou marquez-la comme remplacée.",
        action: "Réexaminer la décision",
      },
      approval_requested: {
        subject: "Approbation demandée : {title}",
        preheader: "Approuvez ou rejetez la décision depuis sa session.",
        heading: "Une décision attend votre approbation",
        body: "Un membre de l'équipe demande l'approbation de cette décision. Ouvrez-la pour l'approuver ou la rejeter.",
        action: "Ouvrir la décision",
      },
    },
  },
  es: {
    linkHint: "Si el botón no funciona, copie este enlace en su navegador:",
    footerNotify: "Recibe este correo porque las notificaciones por correo están activadas para este debate.",
    footerAuthor: "Recibe este correo porque usted inició esta sesión.",
    footerReview: "Recibe este correo porque usted redactó o aprobó esta decisión.",
    footerServer: "Este servidor de Quorumind envía sus notificaciones a esta dirección.",
    messages: {
      complete: {
        subject: "Veredicto listo: {title}",
        preheader: "El árbitro ha decidido: el veredicto y el informe están listos.",
        heading: "El veredicto está listo",
        body: "El árbitro ha emitido su veredicto. Abra la sesión para leerlo y descargar el informe.",
        action: "Leer el veredicto",
      },
      awaiting_answers: {
        subject: "Se necesita su respuesta: {title}",
        preheader: "El debate continúa en cuanto responda.",
        heading: "El debate necesita su respuesta",
        body: "Para continuar, los modelos necesitan información que solo usted tiene. Responda a sus preguntas y el debate se reanudará.",
        action: "Responder a las preguntas",
      },
      failed: {
        subject: "Sesión detenida: {title}",
        preheader: "No se ha perdido nada: reanúdela desde donde se detuvo.",
        heading: "La sesión se ha detenido",
        body: "La sesión se detuvo por un error. Ábrala para reanudarla desde donde se detuvo: no se ha perdido nada de lo hecho.",
        action: "Reanudar la sesión",
      },
      answers_received: {
        subject: "Su cliente ha respondido: {title}",
        preheader: "Lea las respuestas y actualice después la recomendación.",
        heading: "Su cliente ha respondido al cuestionario",
        body: "Abra la sesión para leer las respuestas y actualice después la recomendación con ellas.",
        action: "Leer las respuestas",
      },
      review_due: {
        subject: "Decisión por revisar: {title}",
        preheader: "Compruebe que la decisión sigue siendo válida.",
        heading: "Una decisión debe revisarse",
        body: "Ha llegado la fecha fijada para revisar esta decisión. Ábrala para comprobar que sigue siendo válida: apruébela de nuevo, actualícela con lo que haya cambiado o márquela como sustituida.",
        action: "Revisar la decisión",
      },
      approval_requested: {
        subject: "Aprobación solicitada: {title}",
        preheader: "Apruebe o rechace la decisión desde su sesión.",
        heading: "Una decisión espera su aprobación",
        body: "Un miembro del equipo solicita la aprobación de esta decisión. Ábrala para aprobarla o rechazarla.",
        action: "Abrir la decisión",
      },
    },
  },
  pt: {
    linkHint: "Se o botão não funcionar, copie este link no seu navegador:",
    footerNotify: "Você recebe este e-mail porque as notificações por e-mail estão ativadas para este debate.",
    footerAuthor: "Você recebe este e-mail porque iniciou esta sessão.",
    footerReview: "Você recebe este e-mail porque redigiu ou aprovou esta decisão.",
    footerServer: "Este servidor do Quorumind envia suas notificações para este endereço.",
    messages: {
      complete: {
        subject: "Veredito pronto: {title}",
        preheader: "O árbitro decidiu: o veredito e o relatório estão prontos.",
        heading: "O veredito está pronto",
        body: "O árbitro deu o veredito. Abra a sessão para lê-lo e baixar o relatório.",
        action: "Ler o veredito",
      },
      awaiting_answers: {
        subject: "Sua resposta é necessária: {title}",
        preheader: "O debate continua assim que você responder.",
        heading: "O debate precisa da sua resposta",
        body: "Para continuar, os modelos precisam de informações que só você tem. Responda às perguntas e o debate será retomado.",
        action: "Responder às perguntas",
      },
      failed: {
        subject: "Sessão interrompida: {title}",
        preheader: "Nada se perdeu: retome de onde parou.",
        heading: "A sessão foi interrompida",
        body: "A sessão foi interrompida por um erro. Abra-a para retomar de onde parou: nada do que foi feito se perdeu.",
        action: "Retomar a sessão",
      },
      answers_received: {
        subject: "Seu cliente respondeu: {title}",
        preheader: "Leia as respostas e depois atualize a recomendação.",
        heading: "Seu cliente respondeu ao questionário",
        body: "Abra a sessão para ler as respostas e depois atualize a recomendação com elas.",
        action: "Ler as respostas",
      },
      review_due: {
        subject: "Decisão a revisar: {title}",
        preheader: "Verifique se a decisão continua válida.",
        heading: "Uma decisão precisa ser revisada",
        body: "Chegou a data definida para rever esta decisão. Abra-a para verificar se continua válida: aprove-a novamente, atualize-a com o que mudou ou marque-a como substituída.",
        action: "Revisar a decisão",
      },
      approval_requested: {
        subject: "Aprovação solicitada: {title}",
        preheader: "Aprove ou rejeite a decisão na sessão dela.",
        heading: "Uma decisão aguarda sua aprovação",
        body: "Um membro da equipe pede a aprovação desta decisão. Abra-a para aprová-la ou rejeitá-la.",
        action: "Abrir a decisão",
      },
    },
  },
  it: {
    linkHint: "Se il pulsante non funziona, copia questo link nel browser:",
    footerNotify: "Ricevi questa e-mail perché le notifiche via e-mail sono attive per questo dibattito.",
    footerAuthor: "Ricevi questa e-mail perché hai avviato questa sessione.",
    footerReview: "Ricevi questa e-mail perché hai redatto o approvato questa decisione.",
    footerServer: "Questo server Quorumind invia le sue notifiche a questo indirizzo.",
    messages: {
      complete: {
        subject: "Verdetto pronto: {title}",
        preheader: "L'arbitro ha deciso: il verdetto e il report sono pronti.",
        heading: "Il verdetto è pronto",
        body: "L'arbitro ha emesso il verdetto. Apri la sessione per leggerlo e scaricare il report.",
        action: "Leggi il verdetto",
      },
      awaiting_answers: {
        subject: "Serve la tua risposta: {title}",
        preheader: "Il dibattito riprende appena rispondi.",
        heading: "Il dibattito attende la tua risposta",
        body: "Per proseguire, i modelli hanno bisogno di informazioni che solo tu hai. Rispondi alle domande e il dibattito riprende.",
        action: "Rispondi alle domande",
      },
      failed: {
        subject: "Sessione interrotta: {title}",
        preheader: "Non è andato perso nulla: riprendila da dove si è fermata.",
        heading: "La sessione si è interrotta",
        body: "La sessione si è interrotta per un errore. Aprila per riprenderla da dove si è fermata: nulla di quanto fatto è andato perso.",
        action: "Riprendi la sessione",
      },
      answers_received: {
        subject: "Il tuo cliente ha risposto: {title}",
        preheader: "Leggi le risposte, poi aggiorna la raccomandazione.",
        heading: "Il tuo cliente ha risposto al questionario",
        body: "Apri la sessione per leggere le risposte, poi aggiorna la raccomandazione con esse.",
        action: "Leggi le risposte",
      },
      review_due: {
        subject: "Decisione da rivedere: {title}",
        preheader: "Verifica che la decisione sia ancora valida.",
        heading: "Una decisione è da rivedere",
        body: "È arrivata la data fissata per rivedere questa decisione. Aprila per verificare che sia ancora valida: approvala di nuovo, aggiornala con ciò che è cambiato o segnalala come sostituita.",
        action: "Rivedi la decisione",
      },
      approval_requested: {
        subject: "Approvazione richiesta: {title}",
        preheader: "Approva o rifiuta la decisione dalla sua sessione.",
        heading: "Una decisione attende la tua approvazione",
        body: "Un membro del team chiede di approvare questa decisione. Aprila per approvarla o rifiutarla.",
        action: "Apri la decisione",
      },
    },
  },
  de: {
    linkHint: "Falls die Schaltfläche nicht funktioniert, kopieren Sie diesen Link in Ihren Browser:",
    footerNotify: "Sie erhalten diese E-Mail, weil E-Mail-Benachrichtigungen für diese Debatte aktiviert sind.",
    footerAuthor: "Sie erhalten diese E-Mail, weil Sie diese Sitzung gestartet haben.",
    footerReview: "Sie erhalten diese E-Mail, weil Sie diese Entscheidung verfasst oder genehmigt haben.",
    footerServer: "Dieser Quorumind-Server sendet seine Benachrichtigungen an diese Adresse.",
    messages: {
      complete: {
        subject: "Urteil liegt vor: {title}",
        preheader: "Der Schiedsrichter hat entschieden: Urteil und Bericht liegen vor.",
        heading: "Das Urteil liegt vor",
        body: "Der Schiedsrichter hat sein Urteil gefällt. Öffnen Sie die Sitzung, um es zu lesen und den Bericht herunterzuladen.",
        action: "Urteil lesen",
      },
      awaiting_answers: {
        subject: "Ihre Antwort wird gebraucht: {title}",
        preheader: "Die Debatte geht weiter, sobald Sie antworten.",
        heading: "Die Debatte braucht Ihre Antwort",
        body: "Um weiterzumachen, brauchen die Modelle Informationen, die nur Sie haben. Beantworten Sie ihre Fragen, dann geht die Debatte weiter.",
        action: "Fragen beantworten",
      },
      failed: {
        subject: "Sitzung angehalten: {title}",
        preheader: "Nichts ist verloren: Setzen Sie sie dort fort, wo sie angehalten hat.",
        heading: "Die Sitzung wurde angehalten",
        body: "Die Sitzung wurde wegen eines Fehlers angehalten. Öffnen Sie sie, um dort fortzufahren, wo sie angehalten hat: Nichts Erledigtes ist verloren.",
        action: "Sitzung fortsetzen",
      },
      answers_received: {
        subject: "Ihr Kunde hat geantwortet: {title}",
        preheader: "Lesen Sie die Antworten und aktualisieren Sie dann die Empfehlung.",
        heading: "Ihr Kunde hat den Fragebogen beantwortet",
        body: "Öffnen Sie die Sitzung, um die Antworten zu lesen, und aktualisieren Sie dann die Empfehlung damit.",
        action: "Antworten lesen",
      },
      review_due: {
        subject: "Entscheidung überprüfen: {title}",
        preheader: "Prüfen Sie, ob die Entscheidung noch gilt.",
        heading: "Eine Entscheidung ist zu überprüfen",
        body: "Der Tag, an dem diese Entscheidung überprüft werden sollte, ist gekommen. Öffnen Sie sie, um zu prüfen, ob sie noch gilt: Genehmigen Sie sie erneut, aktualisieren Sie sie mit dem, was sich geändert hat, oder markieren Sie sie als ersetzt.",
        action: "Entscheidung überprüfen",
      },
      approval_requested: {
        subject: "Genehmigung angefragt: {title}",
        preheader: "Genehmigen Sie die Entscheidung in ihrer Sitzung oder lehnen Sie sie ab.",
        heading: "Eine Entscheidung wartet auf Ihre Genehmigung",
        body: "Ein Mitglied des Teams bittet darum, diese Entscheidung zu genehmigen. Öffnen Sie sie, um sie zu genehmigen oder abzulehnen.",
        action: "Entscheidung öffnen",
      },
    },
  },
  hi: {
    linkHint: "अगर बटन काम न करे, तो यह लिंक अपने ब्राउज़र में कॉपी करें:",
    footerNotify: "आपको यह ई-मेल इसलिए मिला है क्योंकि इस बहस के लिए ई-मेल सूचनाएँ चालू हैं।",
    footerAuthor: "आपको यह ई-मेल इसलिए मिला है क्योंकि यह सत्र आपने शुरू किया था।",
    footerReview: "आपको यह ई-मेल इसलिए मिला है क्योंकि यह निर्णय आपने लिखा या अनुमोदित किया था।",
    footerServer: "यह Quorumind सर्वर अपनी सूचनाएँ इसी पते पर भेजता है।",
    messages: {
      complete: {
        subject: "निर्णय तैयार है: {title}",
        preheader: "निर्णायक ने फ़ैसला दे दिया है: निर्णय और रिपोर्ट तैयार हैं।",
        heading: "निर्णय तैयार है",
        body: "निर्णायक ने अपना फ़ैसला दे दिया है। निर्णय पढ़ने और रिपोर्ट डाउनलोड करने के लिए सत्र खोलें।",
        action: "निर्णय पढ़ें",
      },
      awaiting_answers: {
        subject: "आपके उत्तर की ज़रूरत है: {title}",
        preheader: "आपके उत्तर देते ही बहस फिर शुरू होगी।",
        heading: "बहस को आपके उत्तर की ज़रूरत है",
        body: "आगे बढ़ने के लिए मॉडलों को ऐसी जानकारी चाहिए जो सिर्फ़ आपके पास है। उनके सवालों के जवाब दें, बहस फिर शुरू हो जाएगी।",
        action: "सवालों के जवाब दें",
      },
      failed: {
        subject: "सत्र रुक गया: {title}",
        preheader: "कुछ भी नहीं खोया: जहाँ रुका था वहीं से फिर शुरू करें।",
        heading: "सत्र रुक गया",
        body: "एक त्रुटि के कारण सत्र रुक गया। उसे खोलें और जहाँ रुका था वहीं से फिर शुरू करें: अब तक का कुछ भी नहीं खोया।",
        action: "सत्र फिर शुरू करें",
      },
      answers_received: {
        subject: "आपके क्लाइंट ने जवाब दिया: {title}",
        preheader: "जवाब पढ़ें, फिर सिफ़ारिश अपडेट करें।",
        heading: "आपके क्लाइंट ने प्रश्नावली का जवाब दिया",
        body: "जवाब पढ़ने के लिए सत्र खोलें, फिर उनके आधार पर सिफ़ारिश अपडेट करें।",
        action: "जवाब पढ़ें",
      },
      review_due: {
        subject: "समीक्षा के लिए निर्णय: {title}",
        preheader: "जाँचें कि निर्णय अब भी सही है।",
        heading: "एक निर्णय की समीक्षा का समय आ गया है",
        body: "इस निर्णय पर दोबारा विचार करने की तय तारीख आ गई है। उसे खोलकर जाँचें कि वह अब भी सही है: उसे फिर से अनुमोदित करें, जो बदला है उसके साथ अपडेट करें, या प्रतिस्थापित के रूप में चिह्नित करें।",
        action: "निर्णय की समीक्षा करें",
      },
      approval_requested: {
        subject: "अनुमोदन का अनुरोध: {title}",
        preheader: "सत्र खोलकर निर्णय अनुमोदित या अस्वीकार करें।",
        heading: "एक निर्णय आपके अनुमोदन की प्रतीक्षा में है",
        body: "टीम का एक सदस्य इस निर्णय के अनुमोदन का अनुरोध कर रहा है। इसे अनुमोदित या अस्वीकार करने के लिए खोलें।",
        action: "निर्णय खोलें",
      },
    },
  },
  ja: {
    linkHint: "ボタンが機能しない場合は、このリンクをブラウザにコピーしてください：",
    footerNotify: "この議論のメール通知が有効になっているため、このメールをお送りしています。",
    footerAuthor: "このセッションを開始された方にお送りしています。",
    footerReview: "この決定を作成または承認された方にお送りしています。",
    footerServer: "この Quorumind サーバーは、通知をこのアドレスに送信します。",
    messages: {
      complete: {
        subject: "判定が出ました：{title}",
        preheader: "審判が判定を下しました。判定とレポートをご確認いただけます。",
        heading: "判定が出ました",
        body: "審判が判定を下しました。セッションを開いて判定を読み、レポートをダウンロードしてください。",
        action: "判定を読む",
      },
      awaiting_answers: {
        subject: "回答が必要です：{title}",
        preheader: "回答すると議論が再開します。",
        heading: "議論があなたの回答を待っています",
        body: "議論を続けるには、あなただけが知っている情報がモデルに必要です。質問に回答すると議論が再開します。",
        action: "質問に回答する",
      },
      failed: {
        subject: "セッションが停止しました：{title}",
        preheader: "これまでの作業は失われていません。停止した所から再開できます。",
        heading: "セッションが停止しました",
        body: "エラーによりセッションが停止しました。セッションを開いて、停止した所から再開してください。これまでの作業は失われていません。",
        action: "セッションを再開",
      },
      answers_received: {
        subject: "クライアントが回答しました：{title}",
        preheader: "回答を読み、推奨案を更新してください。",
        heading: "クライアントが質問票に回答しました",
        body: "セッションを開いて回答を読み、それをもとに推奨案を更新してください。",
        action: "回答を読む",
      },
      review_due: {
        subject: "見直しの時期です：{title}",
        preheader: "決定がまだ有効か確認してください。",
        heading: "決定の見直し時期になりました",
        body: "この決定を見直す日になりました。決定を開いて、まだ有効か確認してください。改めて承認する、変化を反映して更新する、または置き換え済みにすることができます。",
        action: "決定を見直す",
      },
      approval_requested: {
        subject: "承認の依頼：{title}",
        preheader: "セッションから決定を承認または却下してください。",
        heading: "決定があなたの承認を待っています",
        body: "チームのメンバーがこの決定の承認を依頼しています。決定を開いて承認または却下してください。",
        action: "決定を開く",
      },
    },
  },
  "zh-Hans": {
    linkHint: "如果按钮无法使用，请将此链接复制到浏览器中：",
    footerNotify: "您收到这封邮件，是因为此辩论开启了邮件通知。",
    footerAuthor: "您收到这封邮件，是因为此会话由您发起。",
    footerReview: "您收到这封邮件，是因为此决策由您撰写或批准。",
    footerServer: "此 Quorumind 服务器会将通知发送到这个地址。",
    messages: {
      complete: {
        subject: "结论已出：{title}",
        preheader: "仲裁者已作出裁决，结论和报告已就绪。",
        heading: "结论已出",
        body: "仲裁者已作出裁决。打开会话即可阅读结论并下载报告。",
        action: "阅读结论",
      },
      awaiting_answers: {
        subject: "需要您的回答：{title}",
        preheader: "您回答后，辩论将立即继续。",
        heading: "辩论需要您的回答",
        body: "模型需要只有您掌握的信息才能继续。回答这些问题后，辩论将继续进行。",
        action: "回答问题",
      },
      failed: {
        subject: "会话已停止：{title}",
        preheader: "已完成的内容不会丢失，可从中断处继续。",
        heading: "会话已停止",
        body: "会话因错误而停止。打开会话即可从中断处继续，已完成的内容不会丢失。",
        action: "继续会话",
      },
      answers_received: {
        subject: "客户已回答：{title}",
        preheader: "阅读回答，然后更新推荐方案。",
        heading: "客户已回答问卷",
        body: "打开会话阅读回答，然后根据回答更新推荐方案。",
        action: "阅读回答",
      },
      review_due: {
        subject: "决策待复审：{title}",
        preheader: "请确认该决策是否仍然有效。",
        heading: "有一项决策需要复审",
        body: "为复审此决策设定的日期已到。请打开它，确认它是否仍然有效：再次批准、根据变化进行更新，或将其标记为已被取代。",
        action: "复审决策",
      },
      approval_requested: {
        subject: "申请批准：{title}",
        preheader: "请在会话中批准或拒绝该决策。",
        heading: "有一项决策等待您批准",
        body: "一位团队成员申请批准此决策。请打开它进行批准或拒绝。",
        action: "打开决策",
      },
    },
  },
  ar: {
    linkHint: "إذا لم يعمل الزر، انسخ هذا الرابط في متصفحك:",
    footerNotify: "تصلك هذه الرسالة لأن إشعارات البريد الإلكتروني مفعّلة لهذا النقاش.",
    footerAuthor: "تصلك هذه الرسالة لأنك بدأت هذه الجلسة.",
    footerReview: "تصلك هذه الرسالة لأنك كتبت هذا القرار أو اعتمدته.",
    footerServer: "يرسل خادم Quorumind هذا إشعاراته إلى هذا العنوان.",
    messages: {
      complete: {
        subject: "الحكم جاهز: {title}",
        preheader: "أصدر المُحكِّم حكمه: الحكم والتقرير جاهزان.",
        heading: "الحكم جاهز",
        body: "أصدر المُحكِّم حكمه. افتح الجلسة لقراءة الحكم وتنزيل التقرير.",
        action: "اقرأ الحكم",
      },
      awaiting_answers: {
        subject: "إجابتك مطلوبة: {title}",
        preheader: "يُستأنف النقاش فور إجابتك.",
        heading: "النقاش بحاجة إلى إجابتك",
        body: "لكي تتابع النماذج، تحتاج إلى معلومات لا يملكها غيرك. أجب عن أسئلتها ليُستأنف النقاش.",
        action: "أجب عن الأسئلة",
      },
      failed: {
        subject: "توقفت الجلسة: {title}",
        preheader: "لم يُفقد شيء: استأنفها من حيث توقفت.",
        heading: "توقفت الجلسة",
        body: "توقفت الجلسة بسبب خطأ. افتحها لاستئنافها من حيث توقفت: لم يُفقد شيء مما أُنجز.",
        action: "استأنف الجلسة",
      },
      answers_received: {
        subject: "أجاب عميلك: {title}",
        preheader: "اقرأ الإجابات، ثم حدّث التوصية.",
        heading: "أجاب عميلك عن الاستبيان",
        body: "افتح الجلسة لقراءة الإجابات، ثم حدّث التوصية بناءً عليها.",
        action: "اقرأ الإجابات",
      },
      review_due: {
        subject: "قرار تجب مراجعته: {title}",
        preheader: "تحقّق من أن القرار ما زال صالحًا.",
        heading: "حان موعد مراجعة قرار",
        body: "حلّ الموعد المحدد لإعادة النظر في هذا القرار. افتحه لتتحقق من أنه ما زال صالحًا: اعتمده من جديد، أو حدّثه بما تغيّر، أو حدّده كقرار مُستبدَل.",
        action: "راجع القرار",
      },
      approval_requested: {
        subject: "طلب اعتماد: {title}",
        preheader: "اعتمد القرار أو ارفضه من جلسته.",
        heading: "قرار بانتظار اعتمادك",
        body: "يطلب أحد أعضاء الفريق اعتماد هذا القرار. افتحه لاعتماده أو رفضه.",
        action: "افتح القرار",
      },
    },
  },
};
