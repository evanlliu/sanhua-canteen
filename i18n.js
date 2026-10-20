export const LANGUAGES = ['zh', 'en', 'es'];
export const DICT = {
  zh: {
    pageTitle:'员工用餐预约',siteName:'员工用餐预约',myReservations:'我的预约',employeeSection:'确认员工信息',employeeHint:'请输入工号并从下拉结果中选择',
    employeeId:'员工工号',employeePlaceholder:'输入工号（支持 1 位起）',employeeTip:'请从花名册中选择正确的员工。',mealDate:'用餐时间（当天）',todayOnly:'只能预约当天用餐，日期不可修改。',
    chooseMeal:'选择预约餐次',mealRule:'每位员工每天每个餐次限预约一次',loadingMeals:'正在读取餐次设置…',lookupTitle:'查看我的预约',lookupHint:'输入工号查询预约号码',lookupPlaceholder:'输入完整工号查看预约号码',lookupBtn:'查询预约',
    demoNotice:'🧪 演示模式：数据仅保存在当前浏览器，不会写入正式系统。',invalidSearch:'请输入 1～24 位数字工号',noEmployee:'没有匹配的员工，请确认工号',searching:'正在搜索员工…',selected:'已选择：{name}（{id}）',changeEmployee:'更换员工',
    noAvailableMeals:'当前没有可预约的餐次，请在开放时段再来。',closed:'暂未开放',ended:'今日已结束',open:'开放预约',closedBtn:'餐次暂未开放',endedBtn:'本餐今日已结束',bookNow:'立即预约',noMeals:'暂无餐次，请联系管理员配置。',
    chooseEmployee:'请先从工号下拉列表中选择员工',dateInvalid:'请刷新页面获取当天日期',confirmTitle:'确认预约：{meal}',confirmDesc:'请核对以下信息，确认后自动生成预约号码。',
    name:'姓名',staffNumber:'工号',date:'用餐日期',time:'用餐时段',confirm:'确认预约',goBack:'返回修改',submitting:'正在提交…',retry:'重新提交',
    successTitle:'预约成功！',successDesc:'请保存预约号码，用餐时可向工作人员出示。',reservationNumber:'预约号码',close:'关闭',savedToast:'预约成功，请保存号码 {code}',
    invalidId:'请输入完整的数字工号',querying:'查询中…',notFound:'未找到预约记录，可以先选择餐次预约。',found:'共找到 {count} 条预约记录',booked:'已预约',error:'系统繁忙，请稍后重试',
    errDuplicate:'此员工当天该餐次已经预约，不能重复预约。',errDay:'仅允许预约当天用餐，请刷新页面。',errClosed:'该餐次暂未开放预约。',errNotStarted:'尚未到该餐次的预约时间。',errEnded:'今天该餐次已结束。',errUnknown:'工号不在花名册中。',
    langButton:'🌐 中文 ↻',langTitle:'切换语言：中文 / English / Español',
  },
  en: {
    pageTitle:'Staff Meal Reservations',siteName:'Staff Meal Reservations',myReservations:'My reservations',employeeSection:'Confirm employee',employeeHint:'Enter your employee ID and select a matching result',
    employeeId:'Employee ID',employeePlaceholder:'Enter ID (1 digit or more)',employeeTip:'Select the correct employee from the roster.',mealDate:'Meal time (today)',todayOnly:'Reservations are available for today only. This date cannot be changed.',
    chooseMeal:'Select a meal',mealRule:'One reservation per employee, per meal, per day',loadingMeals:'Loading meal settings…',lookupTitle:'My reservations',lookupHint:'Enter your ID to find your reservation numbers',lookupPlaceholder:'Enter your full employee ID',lookupBtn:'Search',
    demoNotice:'🧪 Demo mode: Data stays in this browser and is not submitted.',invalidSearch:'Enter a numeric ID (1–24 digits)',noEmployee:'No matching employee found',searching:'Searching employees…',selected:'Selected: {name} ({id})',changeEmployee:'Change employee',
    noAvailableMeals:'No meals are available for booking right now. Please check back later.',closed:'Not available',ended:'Ended today',open:'Available',closedBtn:'Not open for booking',endedBtn:'Meal has ended today',bookNow:'Reserve now',noMeals:'No meals configured. Contact the administrator.',
    chooseEmployee:'Select an employee from the dropdown first',dateInvalid:'Refresh the page to get today’s date',confirmTitle:'Confirm: {meal}',confirmDesc:'Review the details below. A reservation number will be generated.',
    name:'Name',staffNumber:'Employee ID',date:'Meal date',time:'Meal time',confirm:'Confirm reservation',goBack:'Go back',submitting:'Submitting…',retry:'Try again',
    successTitle:'Reservation successful!',successDesc:'Keep your reservation number and show it when requested.',reservationNumber:'Reservation number',close:'Close',savedToast:'Reserved! Save your number {code}',
    invalidId:'Enter a complete numeric employee ID',querying:'Searching…',notFound:'No reservations found. Select a meal to book.',found:'Found {count} reservation(s)',booked:'Reserved',error:'Something went wrong. Please try again.',
    errDuplicate:'This meal is already reserved for this employee today.',errDay:'Only today’s meals can be reserved. Refresh the page.',errClosed:'This meal is not available for booking.',errNotStarted:'Reservations for this meal have not started yet.',errEnded:'This meal has already ended today.',errUnknown:'Employee ID is not on the roster.',
    langButton:'🌐 English ↻',langTitle:'Switch language: 中文 / English / Español',
  },
  es: {
    pageTitle:'Reservas del comedor',siteName:'Reservas del comedor',myReservations:'Mis reservas',employeeSection:'Confirma tus datos',employeeHint:'Ingresa tu número de empleado y selecciónalo de la lista',
    employeeId:'Número de empleado',employeePlaceholder:'Ingresa tu número (desde 1 dígito)',employeeTip:'Selecciona a la persona correcta del padrón.',mealDate:'Horario de comida (hoy)',todayOnly:'Solo puedes reservar para hoy. No es posible cambiar la fecha.',
    chooseMeal:'Selecciona tu comida',mealRule:'Una reserva por empleado, por comida y por día',loadingMeals:'Cargando horarios…',lookupTitle:'Consultar mis reservas',lookupHint:'Ingresa tu número para ver los folios de reserva',lookupPlaceholder:'Ingresa tu número completo de empleado',lookupBtn:'Consultar',
    demoNotice:'🧪 Modo de prueba: los datos solo se guardan en este navegador.',invalidSearch:'Ingresa un número de 1 a 24 dígitos',noEmployee:'No se encontró ningún empleado',searching:'Buscando empleados…',selected:'Seleccionado: {name} ({id})',changeEmployee:'Cambiar empleado',
    noAvailableMeals:'Por ahora no hay comidas disponibles para reservar. Vuelve más tarde.',closed:'No disponible',ended:'Terminó hoy',open:'Disponible',closedBtn:'Reservas no disponibles',endedBtn:'Este horario ya terminó',bookNow:'Reservar',noMeals:'No hay comidas configuradas. Comunícate con administración.',
    chooseEmployee:'Primero selecciona un empleado de la lista',dateInvalid:'Actualiza la página para obtener la fecha de hoy',confirmTitle:'Confirmar: {meal}',confirmDesc:'Revisa los datos. Se generará un folio de reserva.',
    name:'Nombre',staffNumber:'Número de empleado',date:'Fecha',time:'Horario',confirm:'Confirmar reserva',goBack:'Regresar',submitting:'Enviando…',retry:'Reintentar',
    successTitle:'¡Reserva confirmada!',successDesc:'Guarda tu folio y muéstralo cuando te lo soliciten.',reservationNumber:'Folio de reserva',close:'Cerrar',savedToast:'¡Reserva confirmada! Guarda el folio {code}',
    invalidId:'Ingresa el número de empleado completo (solo dígitos)',querying:'Consultando…',notFound:'No hay reservas. Puedes seleccionar una comida.',found:'Se encontraron {count} reserva(s)',booked:'Reservado',error:'Ocurrió un problema. Inténtalo de nuevo.',
    errDuplicate:'Ya existe una reserva para esta comida y este empleado hoy.',errDay:'Solo puedes reservar para hoy. Actualiza la página.',errClosed:'Esta comida no está disponible para reservar.',errNotStarted:'Todavía no inicia el horario de reservas para esta comida.',errEnded:'El horario de esta comida ya terminó.',errUnknown:'El empleado no está en el padrón.',
    langButton:'🌐 Español (MX) ↻',langTitle:'Cambiar idioma: 中文 / English / Español (México)',
  },
};
export function translate(lang,key,args={}) {
  return (DICT[lang]?.[key] || DICT.zh[key] || key).replace(/\{(\w+)\}/g, (_,k)=>String(args[k]??''));
}

// The device's preferred language is used on every new page visit.
// Choosing a language manually only changes the current page.
export function detectDeviceLanguage(locales) {
  const list = Array.isArray(locales) ? locales : [locales];
  for (const locale of list) {
    const code = String(locale || '').trim().split(/[-_]/)[0].toLowerCase();
    if (LANGUAGES.includes(code)) return code;
  }
  return 'en'; // Fallback when the device uses an unsupported language.
}
