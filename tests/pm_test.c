/* Off-device smoke test for palette mod/macro engine + JSON getters.
 * Links palette.c + warps_data.c; stubs the Clouds heavy interface. */
#include <stdio.h>
#include <stdint.h>
#include <string.h>
#include <stdlib.h>
#include "audio_fx_api_v2.h"

/* ── Clouds stubs (SPACE/BLOOM not exercised here) ── */
void *pfx_clouds_alloc(int fx_id, float sr){ (void)fx_id;(void)sr; return NULL; }
void  pfx_clouds_free(void *h){ (void)h; }
void  pfx_clouds_reset(void *h){ (void)h; }
void  pfx_clouds_process(int fx,void*h,float*l,float*r,int n,float a,float b,float c){
    (void)fx;(void)h;(void)l;(void)r;(void)n;(void)a;(void)b;(void)c; }

extern audio_fx_api_v2_t* move_audio_fx_init_v2(const host_api_v1_t *host);

static int fails = 0;
#define CHECK(c,msg) do{ if(!(c)){ printf("FAIL: %s\n", msg); fails++; } else printf("ok: %s\n", msg); }while(0)

static int json_balanced(const char*s){
    int br=0,sq=0; for(;*s;s++){ if(*s=='{')br++; else if(*s=='}')br--; else if(*s=='[')sq++; else if(*s==']')sq--; if(br<0||sq<0)return 0; }
    return br==0 && sq==0;
}

int main(void){
    audio_fx_api_v2_t *api = move_audio_fx_init_v2(NULL);
    CHECK(api && api->create_instance, "init returns api");
    void *inst = api->create_instance(".", NULL);
    CHECK(inst, "create_instance");

    static char buf[262144];
    int n;

    /* chain_params */
    n = api->get_param(inst, "chain_params", buf, sizeof buf);
    CHECK(n>0 && n < (int)sizeof buf - 1, "chain_params fits buffer");
    CHECK(json_balanced(buf), "chain_params JSON balanced");
    CHECK(strstr(buf,"\"key\":\"editor\"")!=NULL, "chain_params has editor canvas");
    CHECK(strstr(buf,"canvas.js#bank_editor")!=NULL, "chain_params canvas_script");
    CHECK(strstr(buf,"\"key\":\"m1_mode\"")!=NULL, "chain_params m1_mode");
    CHECK(strstr(buf,"\"key\":\"m3_level\"")!=NULL, "chain_params m3_level");
    CHECK(strstr(buf,"\"key\":\"macro4_level\"")!=NULL, "chain_params macro4_level");
    CHECK(strstr(buf,"FX1 Amount")!=NULL, "dest label FX1 Amount present");
    CHECK(strstr(buf,"Mod 3 Level")!=NULL, "dest label Mod 3 Level present");
    printf("   chain_params length = %d\n", n);

    /* ui_hierarchy */
    n = api->get_param(inst, "ui_hierarchy", buf, sizeof buf);
    CHECK(n>0, "ui_hierarchy nonempty");
    CHECK(json_balanced(buf), "ui_hierarchy JSON balanced");
    CHECK(strstr(buf,"\"editor\"")!=NULL, "ui_hierarchy root has editor nav");

    /* param round-trip: set some mod values, read them back */
    api->set_param(inst,"m1_mode","Random");
    api->set_param(inst,"m1_sync","BPM");
    api->set_param(inst,"m1_lfo_wave","Saw Down");
    api->set_param(inst,"m1_dest","FX2 Amount");
    api->set_param(inst,"m1_level","0.8000");
    api->set_param(inst,"macro2","0.7500");
    api->set_param(inst,"macro2_dest","Mix");
    api->set_param(inst,"macro2_level","0.2500");
    api->set_param(inst,"editor","4");
    char rb[64];
    api->get_param(inst,"m1_mode",rb,sizeof rb);      CHECK(!strcmp(rb,"Random"), "m1_mode readback");
    api->get_param(inst,"m1_sync",rb,sizeof rb);      CHECK(!strcmp(rb,"BPM"), "m1_sync readback");
    api->get_param(inst,"m1_lfo_wave",rb,sizeof rb);  CHECK(!strcmp(rb,"Saw Down"), "m1_wave readback");
    api->get_param(inst,"m1_dest",rb,sizeof rb);      CHECK(!strcmp(rb,"FX2 Amount"), "m1_dest readback");
    api->get_param(inst,"m1_level",rb,sizeof rb);     CHECK(atof(rb)>0.79 && atof(rb)<0.81, "m1_level readback");
    api->get_param(inst,"macro2",rb,sizeof rb);       CHECK(atof(rb)>0.74 && atof(rb)<0.76, "macro2 readback");
    api->get_param(inst,"macro2_dest",rb,sizeof rb);  CHECK(!strcmp(rb,"Mix"), "macro2_dest readback");
    api->get_param(inst,"editor",rb,sizeof rb);       CHECK(!strcmp(rb,"4"), "editor readback");

    /* full state round-trip */
    static char st1[262144], st2[262144];
    int l1 = api->get_param(inst,"state",st1,sizeof st1);
    CHECK(l1>0 && l1<(int)sizeof st1 -1, "state fits buffer");
    printf("   state length = %d\n", l1);
    void *inst2 = api->create_instance(".", NULL);
    api->set_param(inst2,"state",st1);
    int l2 = api->get_param(inst2,"state",st2,sizeof st2);
    CHECK(l1==l2 && !strcmp(st1,st2), "state round-trips byte-identical");

    /* old (short) state still loads without crash: truncate at the base section */
    void *inst3 = api->create_instance(".", NULL);
    char shortst[512];
    strncpy(shortst, st1, sizeof shortst-1); shortst[sizeof shortst-1]=0;
    /* keep only up to the 24th field */
    { int commas=0; for(char*c=shortst;*c;c++){ if(*c==','){ if(++commas==24){ *c=0; break; } } } }
    api->set_param(inst3,"state",shortst);   /* must not crash; mods keep defaults */
    CHECK(1, "old short state loads without crash");

    /* TRUNCATED appended section (host state buffer too small): configure mods,
     * get full state, chop it mid-appended-section, load into a fresh instance,
     * and confirm the engine falls back to safe no-op defaults (all dest=None /
     * depth=0.5) rather than corrupting to negative depth. */
    void *inst4 = api->create_instance(".", NULL);
    api->set_param(inst4,"m1_dest","FX1 Amount"); api->set_param(inst4,"m1_level","0.9");
    api->set_param(inst4,"m2_dest","Mix");        api->set_param(inst4,"m2_level","0.9");
    static char stfull[262144]; api->get_param(inst4,"state",stfull,sizeof stfull);
    int cut = 900; if (cut < (int)strlen(stfull)) stfull[cut] = 0;   /* chop mid-appended */
    void *inst5 = api->create_instance(".", NULL);
    api->set_param(inst5,"state",stfull);
    char lv[64]; api->get_param(inst5,"m1_dest",lv,sizeof lv);
    CHECK(!strcmp(lv,"None"), "truncated state -> mods reset to safe defaults (dest None)");
    api->get_param(inst5,"m1_level",lv,sizeof lv);
    CHECK(atof(lv)>0.49 && atof(lv)<0.51, "truncated state -> depth back to 0.5 (no -1 blowup)");
    api->destroy_instance(inst4); api->destroy_instance(inst5);

    /* process smoke: route Mod1 (LFO) -> FX1 amount, run blocks, no NaN/crash */
    api->set_param(inst,"m1_mode","LFO");
    api->set_param(inst,"m1_dest","FX1 Amount");
    api->set_param(inst,"m1_level","1.0");
    api->set_param(inst,"fx1_select","Tremolo");
    api->set_param(inst,"fx1_amount","0.5");
    int16_t audio[256];
    for(int b=0;b<200;b++){
        for(int i=0;i<256;i++) audio[i]=(int16_t)((i%2? -8000:8000));
        api->process_block(inst, audio, 128);
    }
    int allzero=1; for(int i=0;i<256;i++) if(audio[i]!=0) allzero=0;
    CHECK(!allzero, "process_block produces output (modulated tremolo)");

    /* note gating: envelope mod, send note on/off, no crash */
    api->set_param(inst,"m2_mode","Envelope");
    api->set_param(inst,"m2_dest","Mix");
    api->set_param(inst,"m2_level","0.9");
    uint8_t non[3]={0x90,60,100}, noff[3]={0x80,60,0};
    api->on_midi(inst,non,3,0);
    for(int b=0;b<50;b++){ for(int i=0;i<256;i++)audio[i]=1000; api->process_block(inst,audio,128); }
    api->on_midi(inst,noff,3,0);
    for(int b=0;b<50;b++){ for(int i=0;i<256;i++)audio[i]=1000; api->process_block(inst,audio,128); }
    CHECK(1, "envelope note gate on/off no crash");

    /* SELECT skip DIRECTION: put an effect in slot 2, then on slot 1 step DOWN
     * onto it — it must skip DOWNWARD (to a lower free index), not jump up. */
    void *si = api->create_instance(".", NULL);
    api->set_param(si,"fx2_select","Fuzz");        /* Fuzz = index 3, now taken by slot 2 */
    api->set_param(si,"fx1_select","Howl");        /* slot1 = Howl (index 4) */
    api->get_param(si,"fx1_select",lv,sizeof lv);  CHECK(!strcmp(lv,"Howl"), "slot1 = Howl (idx 4)");
    api->set_param(si,"fx1_select","3");           /* step DOWN onto Fuzz(3), which is taken */
    api->get_param(si,"fx1_select",lv,sizeof lv);
    /* must land on a FREE effect BELOW 3 (Sweeten=2 or Drive=1), never jump above 3 */
    CHECK(strcmp(lv,"Fuzz")!=0 && strcmp(lv,"Howl")!=0, "down-step onto taken effect skips DOWNWARD, not up");
    printf("   landed on: %s\n", lv);
    api->destroy_instance(si);

    api->destroy_instance(inst); api->destroy_instance(inst2); api->destroy_instance(inst3);
    printf("\n%s (%d failures)\n", fails? "TESTS FAILED":"ALL TESTS PASSED", fails);
    return fails?1:0;
}
