#!/usr/bin/env python3
"""Minimal marker used to verify generic Django project detection."""
import sys

if __name__ == '__main__':
    print('Django adapter fixture', *sys.argv[1:])
