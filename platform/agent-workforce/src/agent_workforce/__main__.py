"""Local offline demonstration; requires an explicit database location."""
import argparse
import json

from .demo import run_demo


def main():
    parser=argparse.ArgumentParser(description='Offline Agent Workforce demonstration')
    commands=parser.add_subparsers(dest='command',required=True)
    demo=commands.add_parser('demo',help='run one synthetic fake command, or observe its stored result')
    demo.add_argument('--db',required=True,help='local SQLite database path')
    args=parser.parse_args()
    print(json.dumps(run_demo(args.db),sort_keys=True))


if __name__ == '__main__': main()
