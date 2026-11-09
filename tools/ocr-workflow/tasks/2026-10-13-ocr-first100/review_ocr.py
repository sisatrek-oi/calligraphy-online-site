"""Record image-backed review choices or regenerate status exports for a run."""
import argparse, json
from pathlib import Path
from ocr_review_store import apply_decisions, export_run, locked, read

def main():
    p=argparse.ArgumentParser(description='记录OCR局部回图处理，不覆盖机器候选。')
    p.add_argument('command',choices=['apply','export','suggest']);p.add_argument('--run',type=Path,required=True)
    p.add_argument('--decisions',type=Path)
    p.add_argument('--vlm-max-calls',type=int,default=12);p.add_argument('--vlm-max-usd',type=float,default=.25)
    p.add_argument('--vlm-retry-failed',action='store_true');args=p.parse_args()
    try:
        if args.command=='apply':
            if args.decisions is None:p.error('apply需要--decisions确认单。')
            result=apply_decisions(args.run,read(args.decisions))
        elif args.command=='suggest':
            from ocr_vlm_review import run_suggestions
            result=run_suggestions(args.run,args.vlm_max_calls,args.vlm_max_usd,args.vlm_retry_failed)
        else:
            with locked(args.run):result=export_run(args.run)
        print(json.dumps({'counts':result['counts'],'failedPages':result['failedPages'],'run':str(args.run),'vlm':result.get('vlmSummary')},ensure_ascii=False))
        if args.command=='suggest' and any(result.get('vlmSummary',{}).get('counts',{}).get(k,0) for k in ['failed','configuration_missing','stale_input']):raise SystemExit(2)
    except (ValueError,OSError,KeyError) as error:p.error(str(error))

if __name__=='__main__':main()
