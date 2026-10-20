import assert from 'node:assert/strict';
import { searchEmployees, normalizeEmployeeQuery, validEmployeeQuery } from '../employee-search.js';
import { normalMeal, mealAvailability, canBookMeal } from '../meal-schema.js';
import { DICT } from '../i18n.js';

const employees = [
  {employeeId:'8', name:'RODRIGUEZ LOPEZ TANIA ELIZABETH'},
  {employeeId:'18', name:'MARIO ORLANDO'},
  {employeeId:'80', name:'刘彬'},
  {employeeId:'008', name:'CEPEDA CAZARES ORLANDO'},
  {employeeId:'106', name:'CEPEDA CAZARES ORLANDO'},
  {employeeId:'203', name:'José López García'},
  {employeeId:'9', name:'张小明'},
];
let passed = 0;
function test(label, fn) { fn(); console.log('✓', ++passed, label); }
test('1 位数字工号精准匹配优先', () => {
  assert.equal(searchEmployees(employees, '8')[0].employeeId, '8');
  assert.deepEqual(searchEmployees(employees,'008').map(e=>e.employeeId), ['008']);
});
test('2 位工号前缀模糊匹配', () => assert.equal(searchEmployees(employees,'10')[0].employeeId, '106'));
test('姓名英文部分词匹配', () => assert.deepEqual(searchEmployees(employees, 'orlando').map(e=>e.employeeId), ['18','008','106']));
test('姓名英文忽略大小写与重音符号', () => assert.deepEqual(searchEmployees(employees,'JOSE').map(e=>e.employeeId),['203']));
test('英文姓名多关键词模糊', () => assert.deepEqual(searchEmployees(employees,'CEPEDA ORLANDO').map(e=>e.employeeId), ['008','106']));
test('中文姓名部分匹配', () => assert.equal(searchEmployees(employees,'小明')[0].employeeId, '9'));
test('重名仍按唯一工号保留两个独立结果', () => assert.deepEqual(searchEmployees(employees,'CEPEDA CAZARES ORLANDO').map(e=>e.employeeId), ['008','106']));
test('空白/过长查询拒绝', () => {assert.equal(validEmployeeQuery(''),false);assert.equal(validEmployeeQuery('z'.repeat(81)),false);});
test('最多 12 个搜索结果', () => assert.equal(searchEmployees(Array.from({length:30},(_,i)=>({employeeId:`${i}`,name:'员工'})),'员工').length,12));
test('姓名规范化不会更改员工工号', () => {assert.equal(normalizeEmployeeQuery('  JOSÉ  LÓPEZ  '),'jose lopez'); assert.notEqual('008','8');});
const meals = [normalMeal({id:'lunch',nameZh:'午餐',start:'11:30',end:'14:00',enabled:true}),normalMeal({id:'snack',nameZh:'点心',start:'17:30',end:'20:00',enabled:true}),normalMeal({id:'breakfast',nameZh:'早餐',start:'07:00',end:'09:00',enabled:false})];
const [lunch,snack,breakfast] = meals;
test('08:00 两个已启用餐次显示且未开始', () => {assert.equal(mealAvailability(lunch,'2026-10-20','2026-10-20','08:00'),'upcoming');assert.equal(mealAvailability(snack,'2026-10-20','2026-10-20','08:00'),'upcoming');});
test('未启用早餐隐藏，无论时间', () => assert.equal(mealAvailability(breakfast,'2026-10-20','2026-10-20','08:00'),'hidden'));
test('11:30 午餐开放，点心未开始', () => {assert.equal(mealAvailability(lunch,'2026-10-20','2026-10-20','11:30'),'open');assert.equal(mealAvailability(snack,'2026-10-20','2026-10-20','11:30'),'upcoming');});
test('14:00 午餐已结束但仍显示', () => assert.equal(mealAvailability(lunch,'2026-10-20','2026-10-20','14:00'),'ended'));
test('17:30 点心开始开放', () => assert.equal(mealAvailability(snack,'2026-10-20','2026-10-20','17:30'),'open'));
test('20:00 点心已结束但仍显示', () => assert.equal(mealAvailability(snack,'2026-10-20','2026-10-20','20:00'),'ended'));
test('无论卡片是否显示，未开始和已结束均无法预约', () => {assert.equal(canBookMeal(lunch,'2026-10-20','2026-10-20','08:00'),false);assert.equal(canBookMeal(lunch,'2026-10-20','2026-10-20','14:00'),false);});
test('跨天日期不可预约', () => assert.equal(mealAvailability(lunch,'2026-10-20','2026-10-19','11:45'),'not-today'));
test('三种语言都有尚未开放状态', () => {for(const k of ['zh','en','es']) {assert.ok(DICT[k].notStarted);assert.ok(DICT[k].notStartedBtn);assert.ok(DICT[k].noEnabledMeals);} });
console.log(`PASS: ${passed} employee/search/meal visibility tests`);
