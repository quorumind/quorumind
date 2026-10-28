import type { ComplianceStatus, ComplianceTemplateId } from "./compliance.ts";
import type { Locale } from "./locales.ts";

// The words of the compliance section and of the method box lines added by the European-only mode and the reference
// cloud prices, in the ten languages of the interface. Each requirement is stated in one plain sentence: the full rule,
// with its source, is what the models read (compliance.ts).

export const REQUIREMENT_IDS = [
  "gdpr_lawful_basis",
  "gdpr_processors",
  "gdpr_transfers",
  "gdpr_retention",
  "gdpr_rights",
  "gdpr_security",
  "gdpr_dpia",
  "gdpr_cookies",
  "health_special_category",
  "health_hds",
  "health_hds_location",
  "health_access",
  "health_dpia",
  "public_secnumcloud",
  "public_accessibility",
  "public_rgs",
  "public_sovereignty",
  "public_reversibility",
  "finance_dora",
  "finance_dora_providers",
  "finance_pci_dss",
  "finance_aml_records",
  "consumer_information",
  "consumer_order_button",
  "consumer_withdrawal",
  "consumer_guarantee",
  "consumer_price_reduction",
  "consumer_reviews",
  "consumer_accessibility",
  "consumer_mediation",
] as const;
export type RequirementId = (typeof REQUIREMENT_IDS)[number];

export interface ComplianceLabels {
  heading: string;
  intro: string;
  requirement: string;
  hard: string;
  status: Record<ComplianceStatus, string>;
  notAssessed: string;
  europeanOnly: string;
  gatewayEu: string;
  gatewayGlobal: string;
  /** {date}: the date of the reference prices. */
  priceReference: string;
  templates: Record<ComplianceTemplateId, string>;
  requirements: Record<RequirementId, string>;
}

export const COMPLIANCE_LABELS: Record<Locale, ComplianceLabels> = {
  en: {
    heading: "Compliance",
    intro:
      "How each option meets the compliance requirements of the project, as the arbiter assessed it. An option that does not meet a hard requirement is not feasible. This is not legal advice: have it checked by your legal adviser or your data protection officer.",
    requirement: "Requirement",
    hard: "hard constraint",
    status: { met: "Met", partly: "Partly met", not_met: "Not met", not_applicable: "Does not apply" },
    notAssessed: "Not assessed",
    europeanOnly:
      "European models only: every role was played by a model of a European provider served from the EU, or by a model run on the premises.",
    gatewayEu: "The requests to OpenRouter went through its EU region, where questions and answers are processed in Europe.",
    gatewayGlobal:
      "The requests to OpenRouter went through its global servers, which may be outside the EU, before reaching the model's EU endpoint.",
    priceReference:
      "The proposals relied on reference cloud prices as of {date} (public list prices of OVHcloud, Scaleway, AWS, Azure and Google Cloud): check them before committing.",
    templates: {
      personal_data: "Personal data (GDPR)",
      health_data: "Health data",
      public_sector: "Public sector",
      finance: "Finance",
      consumer: "Consumer law (online sales)",
    },
    requirements: {
      gdpr_lawful_basis: "Each purpose has a lawful basis, and only the data it needs is collected (GDPR, art. 5 and 6).",
      gdpr_processors: "Every provider that processes personal data signs a data processing agreement (GDPR, art. 28).",
      gdpr_transfers: "Data stored or accessed outside the EEA has a valid transfer tool (GDPR, chapter V).",
      gdpr_retention: "Each kind of data has a retention period, backups and logs included (GDPR, art. 5).",
      gdpr_rights: "People can see, correct, export and delete their data (GDPR, art. 15 to 22).",
      gdpr_security: "Security suited to the risk, and a procedure to report data breaches within 72 hours (GDPR, art. 32 and 33).",
      gdpr_dpia: "An impact assessment before high-risk processing; check whether it applies (GDPR, art. 35).",
      gdpr_cookies: "Prior consent for cookies and trackers that are not strictly necessary (ePrivacy directive).",
      health_special_category:
        "Health data is processed under an exception of GDPR article 9, such as explicit consent or the provision of care.",
      health_hds: "In France, health data is hosted by HDS-certified providers; check whether it applies.",
      health_hds_location: "In France, HDS hosts keep health data in the EEA and state any access from outside it.",
      health_access: "Access to health data is restricted, with strong sign-in, access logs and encryption.",
      health_dpia: "An impact assessment before processing health data on a large scale; check whether it applies.",
      public_secnumcloud: "In France, sensitive state data is hosted on a SecNumCloud-qualified offer; check whether it applies.",
      public_accessibility: "The services meet the RGAA (WCAG 2.1 AA), with an accessibility statement and a multi-year plan.",
      public_rgs: "In France, public online services get a security accreditation (RGS) before they open; check whether it applies.",
      public_sovereignty: "Where each component is hosted, by which company, and whether laws from outside the EU can reach it.",
      public_reversibility: "Data and code can be recovered in open formats; the purchase follows public procurement rules.",
      finance_dora: "If the client is a financial entity under DORA: ICT risk management, incident reporting and resilience testing.",
      finance_dora_providers:
        "If DORA applies: contracts with ICT providers contain the required clauses, and critical services have an exit plan.",
      finance_pci_dss: "If card data goes through the system: PCI DSS compliance, best avoided with a hosted payment page.",
      finance_aml_records: "If anti-money laundering rules apply: records are kept for five years.",
      consumer_information: "The required information before the order: seller, product, total price, delivery, withdrawal, guarantee.",
      consumer_order_button: "The order button says clearly that ordering means paying.",
      consumer_withdrawal: "A 14-day right of withdrawal with a refund, and an online withdrawal button from 19 June 2026.",
      consumer_guarantee: "The legal guarantee of conformity of at least two years, shown and honoured.",
      consumer_price_reduction: "Price reductions show the lowest price of the previous 30 days.",
      consumer_reviews: "The shop says whether and how it checks customer reviews.",
      consumer_accessibility: "The shop meets the European Accessibility Act (EN 301 549), unless the company is a micro-enterprise.",
      consumer_mediation: "In France, consumers get free access to a consumer mediator named on the site.",
    },
  },
  fr: {
    heading: "Conformité",
    intro:
      "Comment chaque option respecte les exigences de conformité du projet, selon l'évaluation de l'arbitre. Une option qui ne respecte pas une exigence non négociable n'est pas faisable. Ce n'est pas un avis juridique : faites-le vérifier par votre conseil juridique ou votre délégué à la protection des données.",
    requirement: "Exigence",
    hard: "non négociable",
    status: { met: "Respectée", partly: "En partie respectée", not_met: "Non respectée", not_applicable: "Ne s'applique pas" },
    notAssessed: "Non évaluée",
    europeanOnly:
      "Modèles européens uniquement : chaque rôle a été tenu par un modèle d'un fournisseur européen servi depuis l'UE, ou par un modèle exécuté sur place.",
    gatewayEu: "Les requêtes vers OpenRouter sont passées par sa région UE, où les questions et les réponses sont traitées en Europe.",
    gatewayGlobal:
      "Les requêtes vers OpenRouter sont passées par ses serveurs mondiaux, qui peuvent se trouver hors de l'UE, avant d'atteindre le point d'accès européen du modèle.",
    priceReference:
      "Les propositions se sont appuyées sur des prix cloud de référence au {date} (prix publics d'OVHcloud, Scaleway, AWS, Azure et Google Cloud) : vérifiez-les avant de vous engager.",
    templates: {
      personal_data: "Données personnelles (RGPD)",
      health_data: "Données de santé",
      public_sector: "Secteur public",
      finance: "Finance",
      consumer: "Droit de la consommation (vente en ligne)",
    },
    requirements: {
      gdpr_lawful_basis: "Chaque finalité a une base légale, et seules les données nécessaires sont collectées (RGPD, art. 5 et 6).",
      gdpr_processors: "Chaque prestataire qui traite des données personnelles signe un contrat de sous-traitance (RGPD, art. 28).",
      gdpr_transfers: "Les données stockées ou consultées hors de l'EEE disposent d'un outil de transfert valable (RGPD, chapitre V).",
      gdpr_retention: "Chaque type de données a une durée de conservation, sauvegardes et journaux compris (RGPD, art. 5).",
      gdpr_rights: "Les personnes peuvent consulter, corriger, exporter et supprimer leurs données (RGPD, art. 15 à 22).",
      gdpr_security:
        "Une sécurité adaptée au risque, et une procédure pour notifier les violations de données sous 72 heures (RGPD, art. 32 et 33).",
      gdpr_dpia: "Une analyse d'impact avant tout traitement à risque élevé ; vérifiez si elle s'applique (RGPD, art. 35).",
      gdpr_cookies: "Un consentement préalable pour les cookies et traceurs qui ne sont pas strictement nécessaires (directive ePrivacy).",
      health_special_category:
        "Les données de santé sont traitées au titre d'une exception de l'article 9 du RGPD, comme le consentement explicite ou les soins.",
      health_hds: "En France, les données de santé sont hébergées par des prestataires certifiés HDS ; vérifiez si cela s'applique.",
      health_hds_location:
        "En France, les hébergeurs HDS gardent les données de santé dans l'EEE et signalent tout accès depuis l'extérieur.",
      health_access:
        "L'accès aux données de santé est limité, avec une authentification forte, une traçabilité des accès et du chiffrement.",
      health_dpia: "Une analyse d'impact avant de traiter des données de santé à grande échelle ; vérifiez si elle s'applique.",
      public_secnumcloud:
        "En France, les données sensibles de l'État sont hébergées sur une offre qualifiée SecNumCloud ; vérifiez si cela s'applique.",
      public_accessibility: "Les services respectent le RGAA (WCAG 2.1 AA), avec une déclaration d'accessibilité et un schéma pluriannuel.",
      public_rgs: "En France, les téléservices publics sont homologués (RGS) avant leur ouverture ; vérifiez si cela s'applique.",
      public_sovereignty: "Où chaque composant est hébergé, par quelle société, et si des lois hors de l'UE peuvent s'y appliquer.",
      public_reversibility:
        "Les données et le code sont récupérables dans des formats ouverts ; l'achat suit les règles de la commande publique.",
      finance_dora:
        "Si le client est une entité financière soumise à DORA : gestion du risque informatique, déclaration des incidents et tests de résilience.",
      finance_dora_providers:
        "Si DORA s'applique : les contrats avec les prestataires informatiques contiennent les clauses requises, et les services critiques ont un plan de sortie.",
      finance_pci_dss:
        "Si des données de carte passent par le système : conformité PCI DSS, à éviter de préférence grâce à une page de paiement hébergée.",
      finance_aml_records: "Si les règles de lutte contre le blanchiment s'appliquent : documents conservés cinq ans.",
      consumer_information:
        "Les informations obligatoires avant la commande : vendeur, produit, prix total, livraison, rétractation, garantie.",
      consumer_order_button: "Le bouton de commande indique clairement que commander implique de payer.",
      consumer_withdrawal:
        "Un droit de rétractation de 14 jours avec remboursement, et un bouton de rétractation en ligne depuis le 19 juin 2026.",
      consumer_guarantee: "La garantie légale de conformité d'au moins deux ans, affichée et respectée.",
      consumer_price_reduction: "Les réductions de prix affichent le prix le plus bas des 30 jours précédents.",
      consumer_reviews: "La boutique indique si et comment elle vérifie les avis des clients.",
      consumer_accessibility:
        "La boutique respecte l'acte européen sur l'accessibilité (EN 301 549), sauf si l'entreprise est une microentreprise.",
      consumer_mediation: "En France, les consommateurs ont accès gratuitement à un médiateur de la consommation, nommé sur le site.",
    },
  },
  es: {
    heading: "Cumplimiento normativo",
    intro:
      "Cómo cumple cada opción los requisitos normativos del proyecto, según la evaluación del árbitro. Una opción que no cumple un requisito innegociable no es viable. Esto no es asesoramiento jurídico: pida que lo revise su asesor jurídico o su delegado de protección de datos.",
    requirement: "Requisito",
    hard: "innegociable",
    status: { met: "Cumple", partly: "Cumple en parte", not_met: "No cumple", not_applicable: "No se aplica" },
    notAssessed: "Sin evaluar",
    europeanOnly:
      "Solo modelos europeos: cada función la desempeñó un modelo de un proveedor europeo servido desde la UE, o un modelo ejecutado en las propias instalaciones.",
    gatewayEu: "Las solicitudes a OpenRouter pasaron por su región de la UE, donde las preguntas y las respuestas se procesan en Europa.",
    gatewayGlobal:
      "Las solicitudes a OpenRouter pasaron por sus servidores globales, que pueden estar fuera de la UE, antes de llegar al punto de acceso europeo del modelo.",
    priceReference:
      "Las propuestas se apoyaron en precios de referencia de la nube a fecha de {date} (precios públicos de OVHcloud, Scaleway, AWS, Azure y Google Cloud): compruébelos antes de comprometerse.",
    templates: {
      personal_data: "Datos personales (RGPD)",
      health_data: "Datos de salud",
      public_sector: "Sector público",
      finance: "Finanzas",
      consumer: "Derecho del consumidor (venta en línea)",
    },
    requirements: {
      gdpr_lawful_basis: "Cada finalidad tiene una base jurídica y solo se recogen los datos necesarios (RGPD, art. 5 y 6).",
      gdpr_processors: "Cada proveedor que trata datos personales firma un contrato de encargo del tratamiento (RGPD, art. 28).",
      gdpr_transfers:
        "Los datos almacenados o consultados fuera del EEE cuentan con una herramienta de transferencia válida (RGPD, capítulo V).",
      gdpr_retention: "Cada tipo de datos tiene un plazo de conservación, copias de seguridad y registros incluidos (RGPD, art. 5).",
      gdpr_rights: "Las personas pueden consultar, corregir, exportar y suprimir sus datos (RGPD, art. 15 a 22).",
      gdpr_security:
        "Una seguridad adecuada al riesgo y un procedimiento para notificar las brechas de datos en 72 horas (RGPD, art. 32 y 33).",
      gdpr_dpia: "Una evaluación de impacto antes de un tratamiento de alto riesgo; compruebe si se aplica (RGPD, art. 35).",
      gdpr_cookies:
        "Consentimiento previo para las cookies y los rastreadores que no son estrictamente necesarios (Directiva sobre la privacidad electrónica).",
      health_special_category:
        "Los datos de salud se tratan al amparo de una excepción del artículo 9 del RGPD, como el consentimiento explícito o la asistencia sanitaria.",
      health_hds: "En Francia, los datos de salud se alojan en proveedores con certificación HDS; compruebe si se aplica.",
      health_hds_location:
        "En Francia, los proveedores HDS mantienen los datos de salud en el EEE e informan de cualquier acceso desde fuera.",
      health_access: "El acceso a los datos de salud está limitado, con autenticación reforzada, registro de accesos y cifrado.",
      health_dpia: "Una evaluación de impacto antes de tratar datos de salud a gran escala; compruebe si se aplica.",
      public_secnumcloud:
        "En Francia, los datos sensibles del Estado se alojan en una oferta con cualificación SecNumCloud; compruebe si se aplica.",
      public_accessibility: "Los servicios cumplen el RGAA (WCAG 2.1 AA), con una declaración de accesibilidad y un plan plurianual.",
      public_rgs:
        "En Francia, los servicios públicos en línea obtienen una homologación de seguridad (RGS) antes de abrir; compruebe si se aplica.",
      public_sovereignty: "Dónde se aloja cada componente, con qué empresa y si le alcanzan leyes de fuera de la UE.",
      public_reversibility:
        "Los datos y el código se pueden recuperar en formatos abiertos; la compra sigue las normas de contratación pública.",
      finance_dora:
        "Si el cliente es una entidad financiera sujeta a DORA: gestión del riesgo TIC, notificación de incidentes y pruebas de resiliencia.",
      finance_dora_providers:
        "Si se aplica DORA: los contratos con proveedores TIC incluyen las cláusulas exigidas y los servicios críticos tienen un plan de salida.",
      finance_pci_dss: "Si pasan datos de tarjetas por el sistema: cumplimiento de PCI DSS, mejor evitado con una página de pago alojada.",
      finance_aml_records: "Si se aplican las normas contra el blanqueo de capitales: documentos conservados durante cinco años.",
      consumer_information:
        "La información obligatoria antes del pedido: vendedor, producto, precio total, entrega, desistimiento y garantía.",
      consumer_order_button: "El botón de pedido indica claramente que pedir implica pagar.",
      consumer_withdrawal:
        "Derecho de desistimiento de 14 días con reembolso, y un botón de desistimiento en línea desde el 19 de junio de 2026.",
      consumer_guarantee: "La garantía legal de conformidad de al menos dos años, indicada y respetada.",
      consumer_price_reduction: "Las rebajas muestran el precio más bajo de los 30 días anteriores.",
      consumer_reviews: "La tienda indica si comprueba las opiniones de los clientes y cómo lo hace.",
      consumer_accessibility: "La tienda cumple el Acta Europea de Accesibilidad (EN 301 549), salvo si la empresa es una microempresa.",
      consumer_mediation: "En Francia, los consumidores tienen acceso gratuito a un mediador de consumo, indicado en el sitio.",
    },
  },
  pt: {
    heading: "Conformidade",
    intro:
      "Como cada opção atende aos requisitos de conformidade do projeto, segundo a avaliação do árbitro. Uma opção que não atende a um requisito inegociável é inviável. Isto não é aconselhamento jurídico: peça a revisão do seu assessor jurídico ou do seu encarregado de proteção de dados (DPO).",
    requirement: "Requisito",
    hard: "inegociável",
    status: { met: "Atende", partly: "Atende em parte", not_met: "Não atende", not_applicable: "Não se aplica" },
    notAssessed: "Não avaliado",
    europeanOnly:
      "Somente modelos europeus: cada papel foi desempenhado por um modelo de um fornecedor europeu servido a partir da UE, ou por um modelo executado nas próprias instalações.",
    gatewayEu: "As solicitações ao OpenRouter passaram pela região UE do serviço, onde perguntas e respostas são processadas na Europa.",
    gatewayGlobal:
      "As solicitações ao OpenRouter passaram pelos servidores globais do serviço, que podem estar fora da UE, antes de chegar ao ponto de acesso europeu do modelo.",
    priceReference:
      "As propostas se basearam em preços de referência de nuvem de {date} (preços públicos de OVHcloud, Scaleway, AWS, Azure e Google Cloud): confira antes de assumir compromissos.",
    templates: {
      personal_data: "Dados pessoais (RGPD)",
      health_data: "Dados de saúde",
      public_sector: "Setor público",
      finance: "Finanças",
      consumer: "Direito do consumidor (vendas on-line)",
    },
    requirements: {
      gdpr_lawful_basis: "Cada finalidade tem uma base legal, e somente os dados necessários são coletados (RGPD, art. 5 e 6).",
      gdpr_processors: "Cada fornecedor que trata dados pessoais assina um acordo de tratamento de dados (RGPD, art. 28).",
      gdpr_transfers: "Os dados armazenados ou acessados fora do EEE têm um mecanismo de transferência válido (RGPD, capítulo V).",
      gdpr_retention: "Cada tipo de dado tem um prazo de retenção, incluindo backups e registros (RGPD, art. 5).",
      gdpr_rights: "As pessoas podem acessar, corrigir, exportar e excluir seus dados (RGPD, art. 15 a 22).",
      gdpr_security:
        "Segurança adequada ao risco e um procedimento para notificar incidentes com dados em até 72 horas (RGPD, art. 32 e 33).",
      gdpr_dpia: "Uma avaliação de impacto antes de um tratamento de alto risco; verifique se ela se aplica (RGPD, art. 35).",
      gdpr_cookies: "Consentimento prévio para cookies e rastreadores que não são estritamente necessários (Diretiva ePrivacy).",
      health_special_category:
        "Os dados de saúde são tratados com base em uma exceção do artigo 9 do RGPD, como o consentimento explícito ou a prestação de cuidados de saúde.",
      health_hds: "Na França, os dados de saúde ficam hospedados em fornecedores com certificação HDS; verifique se isso se aplica.",
      health_hds_location: "Na França, os provedores HDS mantêm os dados de saúde no EEE e informam qualquer acesso a partir de fora dele.",
      health_access: "O acesso aos dados de saúde é restrito, com autenticação forte, registro dos acessos e criptografia.",
      health_dpia: "Uma avaliação de impacto antes de tratar dados de saúde em grande escala; verifique se ela se aplica.",
      public_secnumcloud:
        "Na França, os dados sensíveis do Estado ficam hospedados em uma oferta qualificada SecNumCloud; verifique se isso se aplica.",
      public_accessibility: "Os serviços atendem ao RGAA (WCAG 2.1 AA), com uma declaração de acessibilidade e um plano plurianual.",
      public_rgs:
        "Na França, os serviços públicos on-line recebem uma homologação de segurança (RGS) antes de entrar no ar; verifique se isso se aplica.",
      public_sovereignty: "Onde cada componente fica hospedado, por qual empresa, e se leis de fora da UE podem alcançá-lo.",
      public_reversibility:
        "Os dados e o código podem ser recuperados em formatos abertos; a compra segue as regras de contratação pública.",
      finance_dora:
        "Se o cliente for uma entidade financeira sujeita ao DORA: gestão do risco de TIC, notificação de incidentes e testes de resiliência.",
      finance_dora_providers:
        "Se o DORA se aplicar: os contratos com fornecedores de TIC contêm as cláusulas exigidas, e os serviços críticos têm um plano de saída.",
      finance_pci_dss:
        "Se dados de cartão passarem pelo sistema: conformidade com o PCI DSS, de preferência evitada com uma página de pagamento hospedada.",
      finance_aml_records: "Se as regras contra a lavagem de dinheiro se aplicarem: registros guardados por cinco anos.",
      consumer_information:
        "As informações obrigatórias antes do pedido: vendedor, produto, preço total, entrega, direito de arrependimento e garantia.",
      consumer_order_button: "O botão de pedido indica claramente que fazer o pedido implica pagar.",
      consumer_withdrawal:
        "Direito de arrependimento de 14 dias com reembolso, e um botão de arrependimento on-line desde 19 de junho de 2026.",
      consumer_guarantee: "A garantia legal de conformidade de pelo menos dois anos, informada e cumprida.",
      consumer_price_reduction: "As reduções de preço mostram o menor preço dos 30 dias anteriores.",
      consumer_reviews: "A loja informa se verifica as avaliações dos clientes e como faz isso.",
      consumer_accessibility: "A loja atende ao Ato Europeu de Acessibilidade (EN 301 549), a menos que a empresa seja uma microempresa.",
      consumer_mediation: "Na França, os consumidores têm acesso gratuito a um mediador de consumo, indicado no site.",
    },
  },
  it: {
    heading: "Conformità",
    intro:
      "Come ogni opzione rispetta i requisiti di conformità del progetto, secondo la valutazione dell'arbitro. Un'opzione che non rispetta un requisito non negoziabile non è fattibile. Non si tratta di una consulenza legale: va verificata da un consulente legale o dal responsabile della protezione dei dati.",
    requirement: "Requisito",
    hard: "non negoziabile",
    status: { met: "Rispettato", partly: "Rispettato in parte", not_met: "Non rispettato", not_applicable: "Non si applica" },
    notAssessed: "Non valutato",
    europeanOnly:
      "Solo modelli europei: ogni ruolo è stato svolto da un modello di un fornitore europeo servito dall'UE, o da un modello eseguito in sede.",
    gatewayEu: "Le richieste a OpenRouter sono passate dalla sua regione UE, dove domande e risposte vengono elaborate in Europa.",
    gatewayGlobal:
      "Le richieste a OpenRouter sono passate dai suoi server globali, che possono trovarsi fuori dall'UE, prima di raggiungere l'endpoint europeo del modello.",
    priceReference:
      "Le proposte si sono basate su prezzi cloud di riferimento aggiornati al {date} (prezzi pubblici di OVHcloud, Scaleway, AWS, Azure e Google Cloud): vanno verificati prima di impegnarsi.",
    templates: {
      personal_data: "Dati personali (GDPR)",
      health_data: "Dati sanitari",
      public_sector: "Settore pubblico",
      finance: "Finanza",
      consumer: "Diritto dei consumatori (vendita online)",
    },
    requirements: {
      gdpr_lawful_basis: "Ogni finalità ha una base giuridica e si raccolgono solo i dati necessari (GDPR, art. 5 e 6).",
      gdpr_processors: "Ogni fornitore che tratta dati personali firma un accordo sul trattamento dei dati (GDPR, art. 28).",
      gdpr_transfers: "I dati conservati o consultati fuori dal SEE dispongono di uno strumento di trasferimento valido (GDPR, capo V).",
      gdpr_retention: "Ogni tipo di dato ha un periodo di conservazione, backup e log compresi (GDPR, art. 5).",
      gdpr_rights: "Le persone possono consultare, correggere, esportare e cancellare i propri dati (GDPR, art. da 15 a 22).",
      gdpr_security:
        "Una sicurezza adeguata al rischio e una procedura per notificare le violazioni dei dati entro 72 ore (GDPR, art. 32 e 33).",
      gdpr_dpia: "Una valutazione d'impatto prima di un trattamento ad alto rischio; verificare se si applica (GDPR, art. 35).",
      gdpr_cookies: "Consenso preventivo per i cookie e gli strumenti di tracciamento non strettamente necessari (direttiva ePrivacy).",
      health_special_category:
        "I dati sanitari sono trattati in base a un'eccezione dell'articolo 9 del GDPR, come il consenso esplicito o la prestazione di cure.",
      health_hds: "In Francia i dati sanitari sono ospitati da fornitori certificati HDS; verificare se si applica.",
      health_hds_location: "In Francia i fornitori HDS conservano i dati sanitari nel SEE e dichiarano ogni accesso dall'esterno.",
      health_access: "L'accesso ai dati sanitari è limitato, con autenticazione forte, registro degli accessi e cifratura.",
      health_dpia: "Una valutazione d'impatto prima di trattare dati sanitari su larga scala; verificare se si applica.",
      public_secnumcloud:
        "In Francia i dati sensibili dello Stato sono ospitati su un'offerta qualificata SecNumCloud; verificare se si applica.",
      public_accessibility: "I servizi rispettano il RGAA (WCAG 2.1 AA), con una dichiarazione di accessibilità e un piano pluriennale.",
      public_rgs:
        "In Francia i servizi pubblici online ottengono un'omologazione di sicurezza (RGS) prima dell'apertura; verificare se si applica.",
      public_sovereignty: "Dove è ospitato ogni componente, da quale società, e se vi si possono applicare leggi extra UE.",
      public_reversibility: "Dati e codice sono recuperabili in formati aperti; l'acquisto segue le regole degli appalti pubblici.",
      finance_dora:
        "Se il cliente è un'entità finanziaria soggetta a DORA: gestione del rischio ICT, segnalazione degli incidenti e test di resilienza.",
      finance_dora_providers:
        "Se si applica DORA: i contratti con i fornitori ICT contengono le clausole richieste e i servizi critici hanno un piano di uscita.",
      finance_pci_dss:
        "Se i dati delle carte passano dal sistema: conformità PCI DSS, da evitare preferibilmente con una pagina di pagamento ospitata.",
      finance_aml_records: "Se si applicano le norme antiriciclaggio: documenti conservati per cinque anni.",
      consumer_information:
        "Le informazioni obbligatorie prima dell'ordine: venditore, prodotto, prezzo totale, consegna, recesso e garanzia.",
      consumer_order_button: "Il pulsante d'ordine indica chiaramente che ordinare comporta l'obbligo di pagare.",
      consumer_withdrawal: "Diritto di recesso di 14 giorni con rimborso, e un pulsante di recesso online dal 19 giugno 2026.",
      consumer_guarantee: "La garanzia legale di conformità di almeno due anni, indicata e rispettata.",
      consumer_price_reduction: "Gli sconti mostrano il prezzo più basso dei 30 giorni precedenti.",
      consumer_reviews: "Il negozio indica se e come verifica le recensioni dei clienti.",
      consumer_accessibility:
        "Il negozio rispetta l'Atto europeo sull'accessibilità (EN 301 549), salvo che l'impresa sia una microimpresa.",
      consumer_mediation: "In Francia i consumatori hanno accesso gratuito a un mediatore dei consumi, indicato sul sito.",
    },
  },
  de: {
    heading: "Compliance",
    intro:
      "Wie jede Option die Compliance-Anforderungen des Projekts erfüllt, nach Einschätzung des Schiedsrichters. Eine Option, die eine harte Vorgabe nicht erfüllt, ist nicht umsetzbar. Dies ist keine Rechtsberatung: Lassen Sie es von Ihrer Rechtsberatung oder Ihrem Datenschutzbeauftragten prüfen.",
    requirement: "Anforderung",
    hard: "harte Vorgabe",
    status: { met: "Erfüllt", partly: "Teilweise erfüllt", not_met: "Nicht erfüllt", not_applicable: "Nicht anwendbar" },
    notAssessed: "Nicht bewertet",
    europeanOnly:
      "Nur europäische Modelle: Jede Rolle wurde von einem Modell eines europäischen Anbieters übernommen, das aus der EU bereitgestellt wird, oder von einem Modell, das vor Ort läuft.",
    gatewayEu: "Die Anfragen an OpenRouter liefen über dessen EU-Region, in der Fragen und Antworten in Europa verarbeitet werden.",
    gatewayGlobal:
      "Die Anfragen an OpenRouter liefen über dessen globale Server, die außerhalb der EU liegen können, bevor sie den EU-Endpunkt des Modells erreichten.",
    priceReference:
      "Die Vorschläge stützten sich auf Cloud-Referenzpreise mit Stand {date} (öffentliche Listenpreise von OVHcloud, Scaleway, AWS, Azure und Google Cloud): Prüfen Sie sie, bevor Sie sich festlegen.",
    templates: {
      personal_data: "Personenbezogene Daten (DSGVO)",
      health_data: "Gesundheitsdaten",
      public_sector: "Öffentlicher Sektor",
      finance: "Finanzwesen",
      consumer: "Verbraucherrecht (Onlinehandel)",
    },
    requirements: {
      gdpr_lawful_basis: "Jeder Zweck hat eine Rechtsgrundlage, und es werden nur die nötigen Daten erhoben (DSGVO, Art. 5 und 6).",
      gdpr_processors:
        "Jeder Anbieter, der personenbezogene Daten verarbeitet, schließt einen Auftragsverarbeitungsvertrag ab (DSGVO, Art. 28).",
      gdpr_transfers:
        "Für Daten, die außerhalb des EWR gespeichert oder abgerufen werden, gibt es ein gültiges Übermittlungsinstrument (DSGVO, Kapitel V).",
      gdpr_retention: "Für jede Datenart gibt es eine Speicherfrist, einschließlich Backups und Protokollen (DSGVO, Art. 5).",
      gdpr_rights: "Betroffene können ihre Daten einsehen, berichtigen, exportieren und löschen (DSGVO, Art. 15 bis 22).",
      gdpr_security:
        "Eine dem Risiko angemessene Sicherheit und ein Verfahren, um Datenpannen binnen 72 Stunden zu melden (DSGVO, Art. 32 und 33).",
      gdpr_dpia: "Eine Datenschutz-Folgenabschätzung vor einer Verarbeitung mit hohem Risiko; prüfen, ob sie nötig ist (DSGVO, Art. 35).",
      gdpr_cookies: "Vorherige Einwilligung für Cookies und Tracker, die nicht unbedingt erforderlich sind (ePrivacy-Richtlinie).",
      health_special_category:
        "Gesundheitsdaten werden auf Grundlage einer Ausnahme nach Artikel 9 DSGVO verarbeitet, etwa einer ausdrücklichen Einwilligung oder der Gesundheitsversorgung.",
      health_hds: "In Frankreich werden Gesundheitsdaten bei HDS-zertifizierten Anbietern gehostet; prüfen, ob das gilt.",
      health_hds_location: "In Frankreich halten HDS-Hoster Gesundheitsdaten im EWR und legen jeden Zugriff von außerhalb offen.",
      health_access:
        "Der Zugriff auf Gesundheitsdaten ist beschränkt, mit starker Authentifizierung, Zugriffsprotokollen und Verschlüsselung.",
      health_dpia: "Eine Datenschutz-Folgenabschätzung vor der umfangreichen Verarbeitung von Gesundheitsdaten; prüfen, ob sie nötig ist.",
      public_secnumcloud:
        "In Frankreich werden sensible Daten des Staates bei einem SecNumCloud-qualifizierten Angebot gehostet; prüfen, ob das gilt.",
      public_accessibility:
        "Die Dienste erfüllen das RGAA (WCAG 2.1 AA), mit einer Erklärung zur Barrierefreiheit und einem Mehrjahresplan.",
      public_rgs: "In Frankreich erhalten öffentliche Onlinedienste vor dem Start eine Sicherheitszulassung (RGS); prüfen, ob das gilt.",
      public_sovereignty:
        "Wo jede Komponente gehostet wird, von welchem Unternehmen, und ob Gesetze außerhalb der EU darauf greifen können.",
      public_reversibility: "Daten und Code lassen sich in offenen Formaten zurückholen; der Einkauf folgt dem Vergaberecht.",
      finance_dora:
        "Wenn der Kunde ein Finanzunternehmen im Sinne von DORA ist: IKT-Risikomanagement, Meldung von Vorfällen und Resilienztests.",
      finance_dora_providers:
        "Wenn DORA gilt: Die Verträge mit IKT-Dienstleistern enthalten die vorgeschriebenen Klauseln, und kritische Dienste haben einen Exit-Plan.",
      finance_pci_dss:
        "Wenn Kartendaten das System durchlaufen: PCI-DSS-Konformität, am besten vermieden durch eine gehostete Zahlungsseite.",
      finance_aml_records: "Wenn Geldwäschevorschriften gelten: Unterlagen werden fünf Jahre aufbewahrt.",
      consumer_information:
        "Die Pflichtinformationen vor der Bestellung: Verkäufer, Produkt, Gesamtpreis, Lieferung, Widerruf und Gewährleistung.",
      consumer_order_button: "Der Bestellbutton sagt klar, dass die Bestellung zahlungspflichtig ist.",
      consumer_withdrawal: "Ein Widerrufsrecht von 14 Tagen mit Erstattung, und seit dem 19. Juni 2026 ein Online-Widerrufsbutton.",
      consumer_guarantee: "Die gesetzliche Gewährleistung von mindestens zwei Jahren wird angegeben und eingehalten.",
      consumer_price_reduction: "Preisermäßigungen zeigen den niedrigsten Preis der vorangegangenen 30 Tage.",
      consumer_reviews: "Der Shop gibt an, ob und wie er Kundenbewertungen prüft.",
      consumer_accessibility:
        "Der Shop erfüllt den European Accessibility Act (EN 301 549), außer das Unternehmen ist ein Kleinstunternehmen.",
      consumer_mediation:
        "In Frankreich haben Verbraucher kostenlosen Zugang zu einer Verbraucherschlichtungsstelle, die auf der Website genannt wird.",
    },
  },
  hi: {
    heading: "अनुपालन",
    intro:
      "निर्णायक के आकलन के अनुसार, हर विकल्प परियोजना की अनुपालन आवश्यकताओं को कैसे पूरा करता है। जो विकल्प किसी अपरिवर्तनीय आवश्यकता को पूरा नहीं करता, वह संभव नहीं है। यह कानूनी सलाह नहीं है: इसे अपने कानूनी सलाहकार या डेटा सुरक्षा अधिकारी से जँचवाएँ।",
    requirement: "आवश्यकता",
    hard: "अपरिवर्तनीय",
    status: { met: "पूरी होती है", partly: "आंशिक रूप से पूरी होती है", not_met: "पूरी नहीं होती", not_applicable: "लागू नहीं" },
    notAssessed: "आकलन नहीं हुआ",
    europeanOnly:
      "केवल यूरोपीय मॉडल: हर भूमिका किसी यूरोपीय प्रदाता के ऐसे मॉडल ने निभाई जो EU से चलाया जाता है, या ऐसे मॉडल ने जो आपके अपने परिसर में चलता है।",
    gatewayEu: "OpenRouter को भेजे गए अनुरोध उसके EU क्षेत्र से होकर गए, जहाँ प्रश्नों और उत्तरों की प्रोसेसिंग यूरोप में होती है।",
    gatewayGlobal: "OpenRouter को भेजे गए अनुरोध मॉडल के यूरोपीय एंडपॉइंट तक पहुँचने से पहले उसके वैश्विक सर्वरों से होकर गए, जो EU से बाहर हो सकते हैं।",
    priceReference:
      "प्रस्तावों ने {date} तक के संदर्भ क्लाउड मूल्यों का उपयोग किया (OVHcloud, Scaleway, AWS, Azure और Google Cloud के सार्वजनिक मूल्य): कोई प्रतिबद्धता करने से पहले इन्हें जाँच लें।",
    templates: {
      personal_data: "व्यक्तिगत डेटा (GDPR)",
      health_data: "स्वास्थ्य डेटा",
      public_sector: "सार्वजनिक क्षेत्र",
      finance: "वित्त",
      consumer: "उपभोक्ता कानून (ऑनलाइन बिक्री)",
    },
    requirements: {
      gdpr_lawful_basis: "हर उद्देश्य का एक वैध कानूनी आधार है, और केवल ज़रूरी डेटा ही एकत्र किया जाता है (GDPR, अनुच्छेद 5 और 6)।",
      gdpr_processors: "व्यक्तिगत डेटा प्रोसेस करने वाला हर प्रदाता डेटा प्रोसेसिंग अनुबंध पर हस्ताक्षर करता है (GDPR, अनुच्छेद 28)।",
      gdpr_transfers: "EEA के बाहर संग्रहीत या देखे जाने वाले डेटा के लिए एक वैध ट्रांसफ़र व्यवस्था है (GDPR, अध्याय V)।",
      gdpr_retention: "हर प्रकार के डेटा की एक प्रतिधारण अवधि है, बैकअप और लॉग सहित (GDPR, अनुच्छेद 5)।",
      gdpr_rights: "लोग अपना डेटा देख, सुधार, निर्यात और हटा सकते हैं (GDPR, अनुच्छेद 15 से 22)।",
      gdpr_security: "जोखिम के अनुरूप सुरक्षा, और डेटा उल्लंघनों की 72 घंटे के भीतर सूचना देने की प्रक्रिया (GDPR, अनुच्छेद 32 और 33)।",
      gdpr_dpia: "उच्च जोखिम वाली प्रोसेसिंग से पहले प्रभाव आकलन; जाँचें कि यह लागू होता है या नहीं (GDPR, अनुच्छेद 35)।",
      gdpr_cookies: "जो कुकीज़ और ट्रैकर पूरी तरह ज़रूरी नहीं हैं, उनके लिए पहले से सहमति (ePrivacy निर्देश)।",
      health_special_category: "स्वास्थ्य डेटा GDPR के अनुच्छेद 9 के किसी अपवाद के तहत प्रोसेस होता है, जैसे स्पष्ट सहमति या चिकित्सा देखभाल।",
      health_hds: "फ़्रांस में स्वास्थ्य डेटा HDS-प्रमाणित प्रदाताओं के पास होस्ट होता है; जाँचें कि यह लागू होता है या नहीं।",
      health_hds_location: "फ़्रांस में HDS होस्ट स्वास्थ्य डेटा EEA में रखते हैं और बाहर से होने वाली किसी भी पहुँच की जानकारी देते हैं।",
      health_access: "स्वास्थ्य डेटा तक पहुँच सीमित है, मज़बूत प्रमाणीकरण, पहुँच लॉग और एन्क्रिप्शन के साथ।",
      health_dpia: "बड़े पैमाने पर स्वास्थ्य डेटा प्रोसेस करने से पहले प्रभाव आकलन; जाँचें कि यह लागू होता है या नहीं।",
      public_secnumcloud: "फ़्रांस में राज्य का संवेदनशील डेटा SecNumCloud-योग्य सेवा पर होस्ट होता है; जाँचें कि यह लागू होता है या नहीं।",
      public_accessibility: "सेवाएँ RGAA (WCAG 2.1 AA) को पूरा करती हैं, सुलभता घोषणा और बहुवर्षीय योजना के साथ।",
      public_rgs: "फ़्रांस में सार्वजनिक ऑनलाइन सेवाओं को शुरू होने से पहले सुरक्षा मान्यता (RGS) मिलती है; जाँचें कि यह लागू होता है या नहीं।",
      public_sovereignty: "हर घटक कहाँ होस्ट है, किस कंपनी द्वारा, और क्या EU के बाहर के क़ानून उस पर लागू हो सकते हैं।",
      public_reversibility: "डेटा और कोड खुले फ़ॉर्मैट में वापस लिए जा सकते हैं; ख़रीद सार्वजनिक ख़रीद के नियमों के अनुसार होती है।",
      finance_dora: "यदि ग्राहक DORA के अंतर्गत वित्तीय संस्था है: ICT जोखिम प्रबंधन, घटनाओं की रिपोर्टिंग और लचीलापन परीक्षण।",
      finance_dora_providers: "यदि DORA लागू है: ICT प्रदाताओं के अनुबंधों में आवश्यक प्रावधान हैं, और महत्वपूर्ण सेवाओं के लिए निकास योजना है।",
      finance_pci_dss: "यदि कार्ड डेटा सिस्टम से होकर जाता है: PCI DSS अनुपालन; होस्टेड भुगतान पेज से इससे बचना बेहतर है।",
      finance_aml_records: "यदि धन-शोधन विरोधी नियम लागू हैं: रिकॉर्ड पाँच साल तक रखे जाते हैं।",
      consumer_information: "ऑर्डर से पहले अनिवार्य जानकारी: विक्रेता, उत्पाद, कुल मूल्य, डिलीवरी, वापसी का अधिकार और गारंटी।",
      consumer_order_button: "ऑर्डर बटन स्पष्ट बताता है कि ऑर्डर करने का अर्थ भुगतान करना है।",
      consumer_withdrawal: "रिफ़ंड के साथ 14 दिनों का वापसी अधिकार, और 19 जून 2026 से ऑनलाइन वापसी बटन।",
      consumer_guarantee: "कम से कम दो साल की कानूनी अनुरूपता गारंटी, जिसकी जानकारी दी जाती है और जिसका पालन होता है।",
      consumer_price_reduction: "मूल्य में छूट पिछले 30 दिनों की सबसे कम कीमत दिखाती है।",
      consumer_reviews: "दुकान बताती है कि क्या वह ग्राहकों की समीक्षाओं की जाँच करती है, और कैसे।",
      consumer_accessibility: "दुकान यूरोपीय सुलभता अधिनियम (EN 301 549) को पूरा करती है, जब तक कि कंपनी सूक्ष्म उद्यम न हो।",
      consumer_mediation: "फ़्रांस में उपभोक्ताओं को साइट पर बताए गए उपभोक्ता मध्यस्थ तक मुफ़्त पहुँच मिलती है।",
    },
  },
  ja: {
    heading: "コンプライアンス",
    intro:
      "審判の評価による、各選択肢がプロジェクトのコンプライアンス要件をどう満たすか。譲れない要件を満たさない選択肢は実現不可能です。これは法的助言ではありません。法務担当者またはデータ保護責任者に確認してもらってください。",
    requirement: "要件",
    hard: "譲れない",
    status: { met: "満たす", partly: "一部満たす", not_met: "満たさない", not_applicable: "該当しない" },
    notAssessed: "未評価",
    europeanOnly: "欧州のモデルのみ：すべての役割を、EU から提供される欧州企業のモデル、または自社の環境で動くモデルが担当しました。",
    gatewayEu: "OpenRouter へのリクエストは同社の EU リージョンを経由しました。そこでは質問と回答が欧州内で処理されます。",
    gatewayGlobal:
      "OpenRouter へのリクエストは、モデルの EU エンドポイントに届く前に、EU 外にある可能性のある同社のグローバルサーバーを経由しました。",
    priceReference:
      "提案は {date} 時点のクラウド参考価格（OVHcloud、Scaleway、AWS、Azure、Google Cloud の公開価格）を基にしています。契約前に必ず確認してください。",
    templates: {
      personal_data: "個人データ（GDPR）",
      health_data: "医療データ",
      public_sector: "公共部門",
      finance: "金融",
      consumer: "消費者法（オンライン販売）",
    },
    requirements: {
      gdpr_lawful_basis: "各目的に法的根拠があり、必要なデータだけを収集する（GDPR 第5条・第6条）。",
      gdpr_processors: "個人データを処理する各事業者がデータ処理契約を結ぶ（GDPR 第28条）。",
      gdpr_transfers: "EEA 外で保存・参照されるデータに有効な移転手段がある（GDPR 第5章）。",
      gdpr_retention: "データの種類ごとに保存期間があり、バックアップとログも含む（GDPR 第5条）。",
      gdpr_rights: "本人が自分のデータを閲覧・訂正・エクスポート・削除できる（GDPR 第15条〜第22条）。",
      gdpr_security: "リスクに応じたセキュリティと、データ侵害を72時間以内に通知する手順（GDPR 第32条・第33条）。",
      gdpr_dpia: "高リスクの処理の前に影響評価を行う。適用されるか確認すること（GDPR 第35条）。",
      gdpr_cookies: "厳密に必要ではない Cookie やトラッカーには事前の同意が必要（eプライバシー指令）。",
      health_special_category: "医療データは、明示的な同意や医療の提供など、GDPR 第9条の例外に基づいて処理する。",
      health_hds: "フランスでは、医療データを HDS 認証を受けた事業者がホストする。適用されるか確認すること。",
      health_hds_location: "フランスでは、HDS 事業者が医療データを EEA 内に保管し、域外からのアクセスの可能性を公表する。",
      health_access: "医療データへのアクセスを制限し、強固な認証、アクセスログ、暗号化を備える。",
      health_dpia: "医療データを大規模に処理する前に影響評価を行う。適用されるか確認すること。",
      public_secnumcloud: "フランスでは、国の機微なデータを SecNumCloud 認定のサービスでホストする。適用されるか確認すること。",
      public_accessibility: "サービスが RGAA（WCAG 2.1 AA）を満たし、アクセシビリティ宣言と複数年計画を公開する。",
      public_rgs: "フランスでは、公共のオンラインサービスが公開前にセキュリティ認定（RGS）を受ける。適用されるか確認すること。",
      public_sovereignty: "各コンポーネントをどこで、どの企業がホストし、EU 外の法律が及ぶかどうか。",
      public_reversibility: "データとコードをオープンな形式で取り戻せ、調達は公共調達のルールに従う。",
      finance_dora: "顧客が DORA の対象となる金融機関の場合：ICT リスク管理、インシデント報告、レジリエンステスト。",
      finance_dora_providers: "DORA が適用される場合：ICT 事業者との契約に必要な条項を盛り込み、重要なサービスには撤退計画を用意する。",
      finance_pci_dss: "カードデータがシステムを通る場合：PCI DSS への準拠。ホスト型の決済ページで回避するのが望ましい。",
      finance_aml_records: "マネーロンダリング対策の規則が適用される場合：記録を5年間保存する。",
      consumer_information: "注文前の必須情報：販売者、商品、総額、配送、撤回権、保証。",
      consumer_order_button: "注文ボタンで、注文すると支払い義務が生じることを明示する。",
      consumer_withdrawal: "返金を伴う14日間の撤回権と、2026年6月19日以降のオンライン撤回ボタン。",
      consumer_guarantee: "少なくとも2年間の法定適合保証を表示し、それに対応する。",
      consumer_price_reduction: "値引き表示では、直近30日間の最低価格を示す。",
      consumer_reviews: "ショップが顧客レビューを確認しているか、どう確認しているかを示す。",
      consumer_accessibility: "ショップが欧州アクセシビリティ法（EN 301 549）を満たす。ただし零細企業は除く。",
      consumer_mediation: "フランスでは、消費者がサイトに記載された消費者調停人を無料で利用できる。",
    },
  },
  "zh-Hans": {
    heading: "合规",
    intro: "根据仲裁者的评估，各方案如何满足项目的合规要求。不满足硬性要求的方案不可行。这不是法律意见：请让您的法律顾问或数据保护官核实。",
    requirement: "要求",
    hard: "硬性",
    status: { met: "满足", partly: "部分满足", not_met: "不满足", not_applicable: "不适用" },
    notAssessed: "未评估",
    europeanOnly: "仅限欧洲模型：每个角色都由欧洲提供商从欧盟提供的模型担任，或由在本地运行的模型担任。",
    gatewayEu: "发往 OpenRouter 的请求经过其欧盟区域，问题和回答都在欧洲处理。",
    gatewayGlobal: "发往 OpenRouter 的请求在到达模型的欧盟端点之前，经过了其全球服务器，这些服务器可能位于欧盟之外。",
    priceReference:
      "各方案参考了截至 {date} 的云服务参考价格（OVHcloud、Scaleway、AWS、Azure 和 Google Cloud 的公开价格）：做出承诺前请先核实。",
    templates: {
      personal_data: "个人数据（GDPR）",
      health_data: "健康数据",
      public_sector: "公共部门",
      finance: "金融",
      consumer: "消费者法（在线销售）",
    },
    requirements: {
      gdpr_lawful_basis: "每个目的都有合法依据，并且只收集所需的数据（GDPR 第 5 条和第 6 条）。",
      gdpr_processors: "每个处理个人数据的服务商都签署数据处理协议（GDPR 第 28 条）。",
      gdpr_transfers: "在欧洲经济区以外存储或访问的数据有有效的传输工具（GDPR 第五章）。",
      gdpr_retention: "每类数据都有保存期限，包括备份和日志（GDPR 第 5 条）。",
      gdpr_rights: "个人可以查看、更正、导出和删除自己的数据（GDPR 第 15 至 22 条）。",
      gdpr_security: "与风险相称的安全措施，以及在 72 小时内通报数据泄露的流程（GDPR 第 32 条和第 33 条）。",
      gdpr_dpia: "在高风险处理之前进行影响评估；请核实是否适用（GDPR 第 35 条）。",
      gdpr_cookies: "非严格必要的 Cookie 和跟踪器需事先征得同意（电子隐私指令）。",
      health_special_category: "健康数据依据 GDPR 第 9 条的某项例外进行处理，例如明确同意或提供医疗服务。",
      health_hds: "在法国，健康数据由获得 HDS 认证的服务商托管；请核实是否适用。",
      health_hds_location: "在法国，HDS 托管商将健康数据保存在欧洲经济区内，并公开说明是否存在来自区外的访问。",
      health_access: "限制对健康数据的访问，配备强身份验证、访问日志和加密。",
      health_dpia: "在大规模处理健康数据之前进行影响评估；请核实是否适用。",
      public_secnumcloud: "在法国，国家的敏感数据托管在获得 SecNumCloud 资质的服务上；请核实是否适用。",
      public_accessibility: "服务符合 RGAA（WCAG 2.1 AA），并发布无障碍声明和多年计划。",
      public_rgs: "在法国，公共在线服务上线前须获得安全认证（RGS）；请核实是否适用。",
      public_sovereignty: "每个组件托管在哪里、由哪家公司托管，以及是否可能受欧盟以外法律的管辖。",
      public_reversibility: "数据和代码可以开放格式取回；采购遵循公共采购规则。",
      finance_dora: "如果客户是 DORA 所涵盖的金融实体：ICT 风险管理、事件报告和韧性测试。",
      finance_dora_providers: "如果适用 DORA：与 ICT 服务商的合同包含规定条款，关键服务有退出计划。",
      finance_pci_dss: "如果卡数据经过系统：须符合 PCI DSS，最好通过托管支付页面避免卡数据经过系统。",
      finance_aml_records: "如果适用反洗钱规则：记录保存五年。",
      consumer_information: "下单前的必备信息：卖家、商品、总价、配送、撤回权和保证。",
      consumer_order_button: "下单按钮清楚说明下单即需付款。",
      consumer_withdrawal: "14 天撤回权并退款，自 2026 年 6 月 19 日起提供在线撤回按钮。",
      consumer_guarantee: "至少两年的法定符合性保证，予以告知并兑现。",
      consumer_price_reduction: "降价时显示前 30 天内的最低价格。",
      consumer_reviews: "商店说明是否以及如何核实顾客评价。",
      consumer_accessibility: "商店符合《欧洲无障碍法案》（EN 301 549），微型企业除外。",
      consumer_mediation: "在法国，消费者可免费使用网站上注明的消费调解员。",
    },
  },
  ar: {
    heading: "الامتثال",
    intro:
      "كيف يستوفي كل خيار متطلبات الامتثال للمشروع، وفق تقييم الحَكَم. الخيار الذي لا يستوفي متطلبًا غير قابل للتفاوض يكون غير قابل للتنفيذ. هذا ليس استشارة قانونية: اطلب من مستشارك القانوني أو من مسؤول حماية البيانات التحقق منه.",
    requirement: "المتطلب",
    hard: "غير قابل للتفاوض",
    status: { met: "مستوفى", partly: "مستوفى جزئيًا", not_met: "غير مستوفى", not_applicable: "لا ينطبق" },
    notAssessed: "لم يُقيَّم",
    europeanOnly: "نماذج أوروبية فقط: أدّى كل دور نموذجٌ من مزوّد أوروبي يُقدَّم من الاتحاد الأوروبي، أو نموذجٌ يعمل في مقرّك.",
    gatewayEu: "مرّت الطلبات إلى OpenRouter عبر منطقته في الاتحاد الأوروبي، حيث تُعالَج الأسئلة والإجابات داخل أوروبا.",
    gatewayGlobal:
      "مرّت الطلبات إلى OpenRouter عبر خوادمه العالمية، التي قد تقع خارج الاتحاد الأوروبي، قبل أن تصل إلى نقطة الوصول الأوروبية للنموذج.",
    priceReference:
      "اعتمدت المقترحات على أسعار مرجعية للسحابة بتاريخ {date} (الأسعار المعلنة لدى OVHcloud وScaleway وAWS وAzure وGoogle Cloud): تحقّق منها قبل أي التزام.",
    templates: {
      personal_data: "البيانات الشخصية (GDPR)",
      health_data: "البيانات الصحية",
      public_sector: "القطاع العام",
      finance: "المالية",
      consumer: "قانون المستهلك (البيع عبر الإنترنت)",
    },
    requirements: {
      gdpr_lawful_basis: "لكل غرض أساس قانوني، ولا تُجمَع إلا البيانات اللازمة (GDPR، المادتان 5 و6).",
      gdpr_processors: "يوقّع كل مزوّد يعالج بيانات شخصية اتفاقية لمعالجة البيانات (GDPR، المادة 28).",
      gdpr_transfers: "للبيانات المخزّنة أو المطّلع عليها خارج المنطقة الاقتصادية الأوروبية أداة نقل صالحة (GDPR، الفصل الخامس).",
      gdpr_retention: "لكل نوع من البيانات مدة احتفاظ، بما في ذلك النسخ الاحتياطية والسجلات (GDPR، المادة 5).",
      gdpr_rights: "يستطيع الأشخاص الاطلاع على بياناتهم وتصحيحها وتصديرها وحذفها (GDPR، المواد من 15 إلى 22).",
      gdpr_security: "أمان يتناسب مع المخاطر، وإجراء للإبلاغ عن خروقات البيانات خلال 72 ساعة (GDPR، المادتان 32 و33).",
      gdpr_dpia: "تقييم للأثر قبل أي معالجة عالية المخاطر؛ تحقّق مما إذا كان ينطبق (GDPR، المادة 35).",
      gdpr_cookies: "موافقة مسبقة على ملفات تعريف الارتباط وأدوات التتبع غير الضرورية تمامًا (توجيه الخصوصية الإلكترونية).",
      health_special_category: "تُعالَج البيانات الصحية بموجب استثناء من المادة 9 من GDPR، مثل الموافقة الصريحة أو تقديم الرعاية الصحية.",
      health_hds: "في فرنسا، تُستضاف البيانات الصحية لدى مزوّدين حاصلين على شهادة HDS؛ تحقّق مما إذا كان ذلك ينطبق.",
      health_hds_location:
        "في فرنسا، يحتفظ مستضيفو HDS بالبيانات الصحية داخل المنطقة الاقتصادية الأوروبية ويعلنون أي وصول إليها من خارجها.",
      health_access: "الوصول إلى البيانات الصحية محصور، مع مصادقة قوية وسجلات للوصول وتشفير.",
      health_dpia: "تقييم للأثر قبل معالجة البيانات الصحية على نطاق واسع؛ تحقّق مما إذا كان ينطبق.",
      public_secnumcloud: "في فرنسا، تُستضاف البيانات الحساسة للدولة على عرض مؤهَّل وفق SecNumCloud؛ تحقّق مما إذا كان ذلك ينطبق.",
      public_accessibility: "تستوفي الخدمات معيار RGAA (WCAG 2.1 AA)، مع بيان لإمكانية الوصول وخطة متعددة السنوات.",
      public_rgs: "في فرنسا، تحصل الخدمات العامة عبر الإنترنت على اعتماد أمني (RGS) قبل إطلاقها؛ تحقّق مما إذا كان ذلك ينطبق.",
      public_sovereignty: "أين يُستضاف كل مكوّن، ولدى أي شركة، وهل يمكن أن تطاله قوانين من خارج الاتحاد الأوروبي.",
      public_reversibility: "يمكن استرجاع البيانات والشيفرة بصيغ مفتوحة؛ ويخضع الشراء لقواعد المشتريات العامة.",
      finance_dora:
        "إذا كان العميل كيانًا ماليًا خاضعًا لـ DORA: إدارة مخاطر تقنية المعلومات والاتصالات، والإبلاغ عن الحوادث، واختبارات المرونة.",
      finance_dora_providers:
        "إذا كان DORA ينطبق: تتضمن العقود مع مزوّدي تقنية المعلومات والاتصالات البنود المطلوبة، وللخدمات الحرجة خطة خروج.",
      finance_pci_dss: "إذا مرّت بيانات البطاقات عبر النظام: الامتثال لمعيار PCI DSS، ويُفضَّل تجنّب ذلك بصفحة دفع مستضافة.",
      finance_aml_records: "إذا كانت قواعد مكافحة غسل الأموال تنطبق: تُحفَظ السجلات خمس سنوات.",
      consumer_information: "المعلومات الإلزامية قبل الطلب: البائع، والمنتج، والسعر الإجمالي، والتسليم، وحق العدول، والضمان.",
      consumer_order_button: "يوضّح زر الطلب أن الطلب يعني الالتزام بالدفع.",
      consumer_withdrawal: "حق العدول خلال 14 يومًا مع استرداد المبلغ، وزر للعدول عبر الإنترنت منذ 19 يونيو 2026.",
      consumer_guarantee: "الضمان القانوني للمطابقة لمدة سنتين على الأقل، مع الإعلام به والوفاء به.",
      consumer_price_reduction: "تُظهر التخفيضات أدنى سعر خلال الثلاثين يومًا السابقة.",
      consumer_reviews: "يوضّح المتجر ما إذا كان يتحقق من آراء العملاء وكيف يفعل ذلك.",
      consumer_accessibility: "يستوفي المتجر قانون إمكانية الوصول الأوروبي (EN 301 549)، ما لم تكن الشركة مؤسسة متناهية الصغر.",
      consumer_mediation: "في فرنسا، يحصل المستهلكون مجانًا على خدمة وسيط استهلاكي يُذكر اسمه في الموقع.",
    },
  },
};

export function complianceLabels(locale: Locale): ComplianceLabels {
  return COMPLIANCE_LABELS[locale] ?? COMPLIANCE_LABELS.en;
}
