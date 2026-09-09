import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import {setupDigitalPublisher} from '../digital-publisher.js';

function fixture(t){
  const db=new Database(':memory:');db.exec('CREATE TABLE managed_courses(slug TEXT,status TEXT,material_url TEXT);CREATE TABLE trend_topics(id TEXT,title TEXT,status TEXT,published_at TEXT);');
  const state={paused:true,chapters:[],covers:[],coverHook:null,chapterHook:null};
  const service=setupDigitalPublisher({app:express(),db,requireAdmin:(_q,_r,n)=>n(),requireUser:(_q,_r,n)=>n(),sameOriginOnly:(_q,_r,n)=>n(),activeEnrollment:()=>false,schedule:false,canRun:()=>!state.paused,
    generateBookPlan:async()=>{throw Error('No trend should be generated');},
    generateBookChapter:async chapter=>{state.chapters.push(chapter.id);await state.chapterHook?.();return 'conteúdo '.repeat(1000);},
    generateBookCover:async book=>{state.covers.push(book.id);await state.coverHook?.();return '/uploads/cover.png';},generateBookIllustration:async()=>'/uploads/illustration.png'});
  t.after(()=>{service.close();db.close();});return {db,state,service};
}

test('book pause stops new requests while keeping the completed private chapter for a nonduplicate resume',async t=>{
  const f=fixture(t);await f.service.worker();assert.equal(f.state.chapters.length,0);
  f.state.paused=false;f.state.chapterHook=()=>{f.state.paused=true;};await f.service.worker();
  assert.equal(f.state.chapters.length,1);const first=f.state.chapters[0];assert.equal(f.db.prepare('SELECT status FROM digital_book_chapters WHERE id=?').get(first).status,'approved');assert.equal(f.db.prepare("SELECT count(*) n FROM digital_books WHERE status='published'").get().n,0);
  f.state.paused=false;f.state.chapterHook=null;await f.service.worker();assert.equal(f.state.chapters.filter(id=>id===first).length,1);
});

test('a cover already generated when pause arrives remains private in review and is not generated again',async t=>{
  const f=fixture(t);f.db.prepare("UPDATE digital_book_chapters SET content=?,status='approved'").run('conteúdo '.repeat(1000));f.db.prepare('UPDATE digital_books SET word_count=10000,page_count=33').run();
  f.state.paused=false;f.state.coverHook=()=>{f.state.paused=true;};await f.service.worker();assert.equal(f.state.covers.length,1);assert.equal(f.db.prepare('SELECT status FROM digital_books').get().status,'review');
  f.state.paused=false;f.state.coverHook=null;await f.service.worker();assert.equal(f.state.covers.length,1);assert.equal(f.db.prepare("SELECT count(*) n FROM digital_books WHERE status='published'").get().n,0);
});
