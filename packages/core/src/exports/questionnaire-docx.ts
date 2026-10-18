import { HeadingLevel, Paragraph } from "docx";
import { agencyLabels } from "../agency-labels.ts";
import type { Branding } from "../branding.ts";
import type { PublicQuestionnaire } from "../questionnaire.ts";
import { fill } from "../report.ts";
import { formatDate } from "../revision-report.ts";
import { type Block, docxKit, MUTED } from "./docx-kit.ts";

// The questionnaire as a Word document, for clients who prefer to answer by e-mail: each question with a table to
// write the answer and a comment in, under the agency's brand.

export async function renderQuestionnaireDocx(
  questionnaire: PublicQuestionnaire,
  branding: Branding,
  options: { url?: string | null } = {},
): Promise<Uint8Array> {
  const a = agencyLabels(questionnaire.locale);
  const { rtl, run, para, heading, labelled, table, masthead, document } = docxKit(questionnaire.locale, branding);
  const title = fill(a.questionsAbout, { project: questionnaire.project || a.proposal });
  const children: Block[] = [];

  children.push(masthead());
  children.push(para(a.questionnaire.toUpperCase(), { style: { bold: true, color: MUTED, size: 18 }, spacing: 40 }));
  children.push(new Paragraph({ children: [run(title)], heading: HeadingLevel.TITLE, bidirectional: rtl }));
  if (questionnaire.client) children.push(labelled(a.preparedFor, questionnaire.client));
  if (branding.name) children.push(labelled(a.preparedBy, branding.name));
  for (const paragraph of (questionnaire.message ?? a.questionnaireIntro).split(/\n+/).filter(Boolean)) children.push(para(paragraph));
  children.push(para(fill(a.replyBy, { date: formatDate(questionnaire.expiresAt, questionnaire.locale) }), { style: { bold: true } }));
  if (options.url) children.push(para(fill(a.replyOnline, { url: options.url }), { style: { color: MUTED } }));

  questionnaire.questions.forEach((question, index) => {
    const answer = questionnaire.answers.find((item) => item.questionId === question.id);
    children.push(heading(fill(a.question, { number: index + 1 }), 2));
    children.push(para(question.text, { style: { bold: true } }));
    if (question.why) children.push(para(`${a.whyAsked}: ${question.why}`, { style: { color: MUTED, size: 18 } }));
    // A table leaves room to type in Word: the answer, and an optional comment next to it.
    children.push(
      table([a.yourAnswer, a.comment], [[[para(answer?.answer ?? "", { spacing: 600 })], [para(answer?.comment ?? "", { spacing: 600 })]]]),
    );
  });

  const footer = [branding.name, a.questionnaire].filter(Boolean).join(" · ");
  return document({ title, description: a.questionnaire, footer, children });
}
