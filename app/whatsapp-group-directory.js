// Explicit additional destinations authorized by the owner on 2026-09-11.
// They supplement the historical directory; never include all provider groups.
export const WHATSAPP_THEMATIC_GROUPS = Object.freeze([
  {id:'recipes-05',jid:'120363144214473420@g.us',topic:'recipes',name:'🍲 VitrineCity · Receitas da Vovó Maria 05'},
  {id:'recipes-07',jid:'553171498344-1541716690@g.us',topic:'recipes',name:'🍲 VitrineCity · Receitas da Vovó Maria 07'},
  {id:'plants-02',jid:'120363208985861888@g.us',topic:'plants',name:'🌱 VitrineCity · Plantas | Agrotecnica 02'},
  {id:'platform',jid:'5491135894022-1555244246@g.us',topic:'platform',name:'🏙️ VitrineCity · Novidades e Oportunidades'}
]);
const GROUP=/^[0-9A-Za-z._:-]{1,140}@g\.us$/;
const jid=value=>String(value||'').replace(/:\d+(?=@)/,'');
export const providerGroups=data=>Array.isArray(data)?data:Array.isArray(data?.Groups)?data.Groups:Array.isArray(data?.groups)?data.groups:[];
export function whatsappGroupPermission(group,state){
  const own=jid(state?.jid||state?.JID);
  const self=own&&(Array.isArray(group?.Participants)?group.Participants:[]).find(person=>[person.JID,person.PhoneNumber,person.PN,person.LID].some(value=>value&&jid(value)===own));
  const admin=Boolean(self&&(self.IsAdmin===true||self.IsSuperAdmin===true));
  return {member:Boolean(self),admin,canPost:Boolean(self&&!group.Suspended&&!group.IsParent&&(group.IsAnnounce!==true||admin))};
}
export function whatsappCampaignDirectory({history,groupData,state,isGroupAllowed}){
  const groups=new Map(), canonical=providerGroups(groupData),additional=new Set(WHATSAPP_THEMATIC_GROUPS.map(group=>group.jid));
  for(const item of Object.values(history||{}).flatMap(value=>Array.isArray(value)?value:[])){
    const id=String(item.chat_jid||item.ChatJID||'');
    if(GROUP.test(id)&&isGroupAllowed(id)&&!additional.has(id))groups.set(id,{jid:id,name:String(item.group_name||item.name||item.Name||id.split('@')[0]).trim().slice(0,160)});
  }
  for(const group of canonical){
    const id=String(group.JID||group.jid||group.group_jid||''),permission=whatsappGroupPermission(group,state);
    if(!GROUP.test(id)||!isGroupAllowed(id))continue;
    if(group.Suspended===true||group.IsParent===true||(group.IsAnnounce===true&&!permission.admin)){groups.delete(id);continue;}
    if(groups.has(id)||(additional.has(id)&&permission.canPost))groups.set(id,{jid:id,name:String(group.Name||group.name||group.GroupName?.Name||id.split('@')[0]).trim().slice(0,160)});
  }
  return [...groups.values()].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')||a.jid.localeCompare(b.jid));
}
