#!/usr/bin/env python3
"""Petit serveur local pour prévisualiser l'application (dossier app/)."""
import http.server
import os

os.chdir(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app"))
http.server.test(HandlerClass=http.server.SimpleHTTPRequestHandler, port=8642, bind="127.0.0.1")
