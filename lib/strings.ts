export type Language = 'en' | 'fr' | 'ar' | 'es' | 'zh';

export const translations = {
  en: { 
    title: "New Report", 
    proj: "Project", 
    repTitle: "Report Title", 
    desc: "Description", 
    result: "Result", 
    pass: "PASS", 
    fail: "FAIL", 
    submit: "SUBMIT REPORT", 
    upload: "Upload PDF/Photo", 
    success: "Success", 
    error: "Error", 
    fill: "Please fill all fields",
    submitReportTitle: "Submit Report",
    reportSubmitted: "Report submitted successfully!",
    enterTitle: "Enter report title...",
    enterDesc: "Enter description...",
    send: "SEND REPORT"
  },
  fr: { 
    title: "Nouveau Rapport", 
    proj: "Projet", 
    repTitle: "Titre du rapport", 
    desc: "Description", 
    result: "Résultat", 
    pass: "CONFORME", 
    fail: "NON CONFORME", 
    submit: "ENVOYER", 
    upload: "Télécharger", 
    success: "Succès", 
    error: "Erreur", 
    fill: "Remplissez tout",
    submitReportTitle: "Envoyer le Rapport",
    reportSubmitted: "Rapport envoyé avec succès!",
    enterTitle: "Entrez le titre...",
    enterDesc: "Entrez la description...",
    send: "ENVOYER"
  },
  ar: { 
    title: "تقرير جديد", 
    proj: "مشروع", 
    repTitle: "عنوان التقرير", 
    desc: "الوصف", 
    result: "النتيجة", 
    pass: "مقبول", 
    fail: "مرفوض", 
    submit: "إرسال التقرير", 
    upload: "تحميل", 
    success: "تم بنجاح", 
    error: "خطأ", 
    fill: "يرجى ملء الحقول",
    submitReportTitle: "إرسال التقرير",
    reportSubmitted: "تم إرسال التقرير بنجاح!",
    enterTitle: "أدخل عنوان التقرير...",
    enterDesc: "أدخل الوصف...",
    send: "إرسال"
  },
  es: { 
    title: "Nuevo Informe", 
    proj: "Proyecto", 
    repTitle: "Título", 
    desc: "Descripción", 
    result: "Resultado", 
    pass: "APROBADO", 
    fail: "RECHAZADO", 
    submit: "ENVIAR", 
    upload: "Subir", 
    success: "Éxito", 
    error: "Error", 
    fill: "Rellene todo",
    submitReportTitle: "Enviar Informe",
    reportSubmitted: "¡Informe enviado con éxito!",
    enterTitle: "Ingrese el título...",
    enterDesc: "Ingrese la descripción...",
    send: "ENVIAR"
  },
  zh: { 
    title: "新报告", 
    proj: "项目", 
    repTitle: "标题", 
    desc: "描述", 
    result: "结果", 
    pass: "通过", 
    fail: "不通过", 
    submit: "提交", 
    upload: "上传", 
    success: "成功", 
    error: "错误", 
    fill: "请填写所有",
    submitReportTitle: "提交报告",
    reportSubmitted: "报告提交成功！",
    enterTitle: "输入报告标题...",
    enterDesc: "输入描述...",
    send: "发送"
  }
};

// Helper function to get translation
export function getTranslation(key: string, lang: Language): string {
  const langTranslations = translations[lang];
  if (langTranslations && key in langTranslations) {
    return langTranslations[key as keyof typeof langTranslations];
  }
  // Fallback to English if key not found
  const enTranslations = translations.en;
  return enTranslations[key as keyof typeof enTranslations] || key;
}
