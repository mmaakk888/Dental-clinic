import React, {useEffect,useRef,useState} from 'react';
import {ArrowRight,Sliders,Palette,Layout,FileSpreadsheet,Users,ShieldAlert,Check,MessageCircle,Pill,Cloud,ChevronLeft,ChevronDown,X,Server} from 'lucide-react';
import {useAppointmentDialog} from '../appointments/useAppointmentDialog';
import './settingsNavigation.css';
export const settingsSections = [
  { key: 'identity', group: 'appearance', label: 'الهوية والمظهر', description: 'اسم العيادة والشعار والألوان', icon: <Palette className="w-4 h-4 text-emerald-500" /> },
  { key: 'layout', group: 'appearance', label: 'المحتوى والترتيب', description: 'ترتيب الشريط وحجمه ونصوص الرئيسية', icon: <Layout className="w-4 h-4 text-indigo-500" /> },
  { key: 'services', group: 'practice', label: 'الخدمات والأسعار', description: 'الخدمات وأسعار البيع وتكاليف المعامل', icon: <Sliders className="w-4 h-4 text-amber-500" /> },
  { key: 'whatsapp', group: 'practice', label: 'إدارة واتساب', description: 'جهات الاتصال والرسائل والحملات', icon: <MessageCircle className="w-4 h-4 text-emerald-600" /> },
  { key: 'drugs', group: 'practice', label: 'فهرس الأدوية', description: 'فهرس الأدوية المستخدم في الروشتة', icon: <Pill className="w-4 h-4 text-purple-500" /> },
  { key: 'backup', group: 'data', label: 'النسخ الاحتياطي', description: 'نسخ البيانات وخيارات الحماية', icon: <Cloud className="w-4 h-4 text-sky-500" /> },
  { key: 'users', group: 'people', label: 'المستخدمون والصلاحيات', description: 'حسابات العمل وصلاحيات الدخول', icon: <Users className="w-4 h-4 text-amber-600" /> },
  { key: 'audit', group: 'people', label: 'سجل النشاطات', description: 'الدخول والعمليات المسجلة', icon: <ShieldAlert className="w-4 h-4 text-rose-500" /> },
  { key: 'excel', group: 'data', label: 'التصدير والاستيراد', description: 'ملفات المرضى وجهات الاتصال والتقارير', icon: <FileSpreadsheet className="w-4 h-4 text-teal-500" /> },
  { key: 'system', group: 'data', label: 'عرض النظام والتأمين', description: 'إعدادات النظام والعمليات الحساسة', icon: <Server className="w-4 h-4 text-purple-600" /> },
] as const;
export type SettingsSectionKey = typeof settingsSections[number]['key'];
const settingsSectionGroups = [
  { key: 'appearance', label: 'مظهر العيادة' },
  { key: 'practice', label: 'الخدمات والتواصل' },
  { key: 'people', label: 'الفريق والخصوصية' },
  { key: 'data', label: 'البيانات والنظام' },
] as const;

function SettingsSectionPicker({ activeSection, sections, onSelect, onClose }: {
  activeSection: SettingsSectionKey;
  sections: ReadonlyArray<(typeof settingsSections)[number]>;
  onSelect: (section: SettingsSectionKey) => void;
  onClose: () => void;
}) {
  const dialogRef = useAppointmentDialog(true, onClose);
  return (
    <div className="clinic-modal-overlay settings-picker-overlay" dir="rtl" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} id="settings-section-picker" role="dialog" aria-modal="true" aria-labelledby="settings-picker-title" tabIndex={-1} className="clinic-modal-panel clinic-modal-panel--framed settings-picker-dialog">
        <div className="settings-picker-header">
          <div><h2 id="settings-picker-title">أقسام الإعدادات</h2><p>اختَر القسم الذي تريد تعديله.</p></div>
          <button type="button" onClick={onClose} aria-label="إغلاق أقسام الإعدادات" className="settings-picker-close"><X aria-hidden="true" /></button>
        </div>
        <div className="settings-picker-groups">
          {settingsSectionGroups.filter(group => sections.some(section => section.group === group.key)).map(group => (
            <section key={group.key} aria-label={group.label} className="settings-picker-group">
              <h3>{group.label}</h3>
              <div className="settings-picker-options">
                {sections.filter(section => section.group === group.key).map(section => {
                  const isActive = section.key === activeSection;
                  return <button key={section.key} type="button" className="settings-picker-option" aria-current={isActive ? 'page' : undefined}
                    data-dialog-autofocus={isActive ? true : undefined} onClick={() => onSelect(section.key)}>
                    <span className="settings-picker-icon" aria-hidden="true">{section.icon}</span>
                    <span className="settings-picker-label"><strong>{section.label}</strong><small>{section.description}</small></span>
                    {isActive ? <Check aria-hidden="true" className="settings-picker-indicator" /> : <ChevronLeft aria-hidden="true" className="settings-picker-indicator" />}
                  </button>;
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}


export function OriginalSettingsLayout({activeSection,sectionKeys,onSection,onBackToHome,children}: {
activeSection:SettingsSectionKey;sectionKeys:readonly SettingsSectionKey[];onSection(section:SettingsSectionKey):void;onBackToHome():void;children:React.ReactNode}) {
const activeSubTab=activeSection, allowedSettingsSections=settingsSections.filter(section=>sectionKeys.includes(section.key));
const selectedSettingsContent=useRef<HTMLDivElement>(null), mobileSettingsAnchor=useRef<HTMLDivElement>(null),mobileSettingsToolbar=useRef<HTMLDivElement>(null);
const [isSettingsPickerOpen,setIsSettingsPickerOpen]=useState(false);
const [settingsToolbarLayout,setSettingsToolbarLayout]=useState({pinned:false,left:0,width:0,height:0});
const activeSettingsSection=allowedSettingsSections.find(section=>section.key===activeSubTab)||allowedSettingsSections[0];
useEffect(()=>{
let frame:number|undefined;
const measure=()=>{frame=undefined;const anchor=mobileSettingsAnchor.current,toolbar=mobileSettingsToolbar.current;if(!anchor||!toolbar)return;
const isMobile=window.matchMedia('(max-width: 1023px)').matches,bounds=anchor.getBoundingClientRect();
const next={pinned:isMobile&&bounds.top<12,left:bounds.left,width:bounds.width,height:toolbar.getBoundingClientRect().height};
setSettingsToolbarLayout(previous=>previous.pinned===next.pinned&&Math.abs(previous.left-next.left)<.5&&Math.abs(previous.width-next.width)<.5&&Math.abs(previous.height-next.height)<.5?previous:next);
if(!isMobile)setIsSettingsPickerOpen(false);};
const schedule=()=>{if(frame===undefined)frame=requestAnimationFrame(measure);};
const observer=new ResizeObserver(schedule);if(mobileSettingsAnchor.current)observer.observe(mobileSettingsAnchor.current);if(mobileSettingsToolbar.current)observer.observe(mobileSettingsToolbar.current);
window.addEventListener('scroll',schedule,{passive:true,capture:true});window.addEventListener('resize',schedule);measure();
return()=>{if(frame!==undefined)cancelAnimationFrame(frame);observer.disconnect();window.removeEventListener('scroll',schedule,true);window.removeEventListener('resize',schedule);};
},[]);
const handleSelectSubTab=(tab:SettingsSectionKey)=>{if(!sectionKeys.includes(tab))return;onSection(tab);setIsSettingsPickerOpen(false);
requestAnimationFrame(()=>{if(!window.matchMedia('(max-width: 1023px)').matches)return;const content=selectedSettingsContent.current;if(!content)return;
const toolbarHeight=mobileSettingsToolbar.current?.getBoundingClientRect().height||0;
window.scrollTo({top:Math.max(0,content.getBoundingClientRect().top+window.scrollY-toolbarHeight-28),behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});content.focus({preventScroll:true});});};
if(!activeSettingsSection)return null;
  return (
    <div className="settings-view space-y-6 max-w-7xl mx-auto py-2 min-w-0">
      {/* View Header */}
      <div className="flex items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-3">
          <button
            type="button" aria-label="العودة للشاشة الرئيسية"
            onClick={onBackToHome}
            className="min-h-[44px] min-w-[44px] p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
            title="رجوع للشاشة الرئيسية"
          >
            <ArrowRight className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-slate-900 font-tajawal tracking-tight">
              لوحة التحكم والإعدادات
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              إعدادات العيادة، الخدمات، التواصل وصلاحيات الفريق
            </p>
          </div>
        </div>
      </div>

      <div ref={mobileSettingsAnchor} className="settings-mobile-nav-anchor" style={settingsToolbarLayout.pinned ? { height: settingsToolbarLayout.height } : undefined}>
        <div ref={mobileSettingsToolbar} className={`settings-mobile-nav${settingsToolbarLayout.pinned ? ' is-pinned' : ''}`}
          style={settingsToolbarLayout.pinned ? { left: settingsToolbarLayout.left, width: settingsToolbarLayout.width } : undefined}>
          <span aria-hidden="true" className="settings-mobile-nav-icon">{activeSettingsSection.icon}</span>
          <div className="settings-mobile-nav-title"><small>القسم الحالي</small><strong aria-live="polite">{activeSettingsSection.label}</strong></div>
          <button type="button" className="settings-mobile-nav-change" aria-haspopup="dialog" aria-expanded={isSettingsPickerOpen}
            aria-controls="settings-section-picker" onClick={() => setIsSettingsPickerOpen(true)}>
            تغيير القسم <ChevronDown aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Modern 2-Column Settings Layout (Internal Sidebar + Active Panel) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* Internal Settings Sidebar Column */}
        <div className="settings-desktop-nav hidden lg:block lg:col-span-3 space-y-3">
          <div className="bg-white rounded-3xl p-3 border border-slate-200/90 shadow-xs space-y-2 lg:sticky lg:top-20">
            <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 font-tajawal flex items-center gap-1.5">
                <Sliders className="w-4 h-4 text-indigo-600" />
                أقسام لوحة التحكم
              </span>
              <span className="text-[10px] bg-indigo-50 text-indigo-700 px-2.5 py-0.5 rounded-full font-extrabold">
                {allowedSettingsSections.length} أقسام
              </span>
            </div>

            <div className="space-y-1">
              {allowedSettingsSections.map(st => {
                const isActive = activeSubTab === st.key;
                return (
                  <button
                    key={st.key}
                    type="button"
                    onClick={() => handleSelectSubTab(st.key)}
                    aria-current={isActive ? 'page' : undefined}
                    className={`w-full flex items-center justify-between p-2.5 sm:p-3 rounded-2xl text-right transition-all cursor-pointer font-tajawal group ${
                      isActive
                        ? 'bg-indigo-600 text-white shadow-md ring-1 ring-indigo-500/30 font-bold'
                        : 'text-slate-700 hover:bg-slate-100/90 hover:text-slate-900'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={`p-2 rounded-xl transition-colors shrink-0 ${
                        isActive ? 'bg-white/15 text-white' : 'bg-slate-100 group-hover:bg-white text-slate-600'
                      }`}>
                        {st.icon}
                      </div>
                      <div className="min-w-0">
                        <div className={`text-xs sm:text-sm font-bold truncate ${isActive ? 'text-white' : 'text-slate-800'}`}>
                          {st.label}
                        </div>
                        <div className={`text-[10px] truncate ${isActive ? 'text-emerald-200' : 'text-slate-500'}`}>
                          {st.description}
                        </div>
                      </div>
                    </div>

                    <ChevronLeft className={`w-4 h-4 shrink-0 transition-all ${
                      isActive ? 'text-white translate-x-[-2px]' : 'text-slate-400 opacity-0 group-hover:opacity-100'
                    }`} />
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Selected Settings Content Panel Column */}
        <div ref={selectedSettingsContent} role="region" aria-label={`إعدادات ${activeSettingsSection.label}`} tabIndex={-1} className="settings-content-panel lg:col-span-9 min-w-0">
        {children}
        </div>
      </div>

      {isSettingsPickerOpen && <SettingsSectionPicker activeSection={activeSubTab} sections={allowedSettingsSections} onSelect={handleSelectSubTab} onClose={() => setIsSettingsPickerOpen(false)} />}

    </div>
  );
}

